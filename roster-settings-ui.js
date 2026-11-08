/* Redesigned editors for the roster settings: Shift Definitions, Roster Patterns, Shift Swap Rules, Duty Roster options and Duty Hours.
   They read and save exactly the same data as the generic table / form editors (settings-engine.js), so nothing stored changes.
   settings-engine.js hands over to window.VEYORA_SETTING_VIEWS[title] when one exists. */
(function () {
  var V = window.VEYORA_SETTING_VIEWS = window.VEYORA_SETTING_VIEWS || {};
  function esc(v) { return String(v == null ? "" : v).replace(/[&<>"']/g, function (c) { return { "&": "&amp;", "<": "&lt;", ">": "&gt;", '"': "&quot;", "'": "&#39;" }[c]; }); }
  function clone(v) { return JSON.parse(JSON.stringify(v)); }
  // The same element can be rendered more than once: keep exactly one handler per event type on it.
  function listen(el, type, fn) { el._rsu = el._rsu || {}; if (el._rsu[type]) el.removeEventListener(type, el._rsu[type]); el._rsu[type] = fn; el.addEventListener(type, fn); }
  function kit() { return window.VeyoraEngine.kit; }
  function ico(p) { return '<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round">' + p + '</svg>'; }
  var I = {
    clock: '<circle cx="12" cy="12" r="9"/><path d="M12 7v5l3 2"/>', plus: '<path d="M12 5v14M5 12h14"/>', swap: '<path d="M7 7h11l-3-3M17 17H6l3 3"/>',
    cal: '<path d="M4 6h16v14H4zM4 10h16M9 3v4M15 3v4"/>', gauge: '<path d="M4 16a8 8 0 1 1 16 0M12 16l4-5"/>', cycle: '<path d="M20 12a8 8 0 1 1-2.3-5.7M20 4v5h-5"/>',
    trash: '<path d="M5 7h14M10 7V5h4v2M8 7v12h8V7"/>', minus: '<path d="M5 12h14"/>'
  };
  var MAIN = { Green: "#16a34a", Lime: "#65a30d", Teal: "#0d9488", Cyan: "#0891b2", Sky: "#0284c7", Blue: "#1677e8", Indigo: "#4f46e5", Purple: "#7c3aed", Violet: "#9333ea",
    Pink: "#db2777", Rose: "#e11d48", Coral: "#ea580c", Orange: "#d97706", Amber: "#ca8a04", Gold: "#a16207", Navy: "#1e3a6e", Slate: "#475569", Grey: "#64748b" };
  function colorOf(name) { return MAIN[name] || "#64748b"; }
  function tint(name) { var h = colorOf(name); return h + "22"; }
  function toMin(t) { var p = String(t || "").split(":"); return (+p[0] || 0) * 60 + (+p[1] || 0); }
  function head(ic, title, text) {
    return '<header class="rsu-head"><span class="rsu-hic">' + ico(ic) + '</span><div><h2>' + esc(title) + '</h2>' + (text ? '<p>' + esc(text) + '</p>' : "") + '</div></header>';
  }
  function shiftsOf(ctx) {
    var raw = ctx.company && ctx.company.settings && ctx.company.settings["8_shift_definitions"];
    var list = Array.isArray(raw) ? raw : ((window.VEYORA_DEFS || {})["Shift Definitions"] || {}).def || [];
    return list.filter(function (s) { return s && s.code; });
  }

  /* ================= Shift Definitions ================= */
  V["Shift Definitions"] = function (el, ctx) {
    var K = kit(), spec = ctx.spec, cols = spec.cols, max = spec.max || 50;
    var pal = window.VEYORA_SHIFT_COLORS || Object.keys(MAIN), GROUPS = ["Everyone", "Captain", "Deck", "Engineering", "Shore"];
    var rows = (Array.isArray(ctx.value) ? ctx.value : spec.def || []).map(clone);
    function minutes(r) { var a = toMin(r.start), b = toMin(r.end), len = (b <= a ? b + 1440 : b) - a; return { len: len, paid: Math.max(0, len - (Number(r.brk) || 0)) }; }
    function fmtH(m) { var h = Math.floor(m / 60), r = m % 60; return h + "h" + (r ? " " + r + "m" : ""); }
    function bar(r) {
      var a = toMin(r.start), b = toMin(r.end), c = colorOf(r.color), seg = function (l, w) { return '<i style="left:' + (l / 14.4).toFixed(2) + '%;width:' + (w / 14.4).toFixed(2) + '%;background:' + c + '"></i>'; };
      return b > a ? seg(a, b - a) : seg(a, 1440 - a) + seg(0, b);
    }
    function ticks() { return '<span class="tk"><em>00</em><em>06</em><em>12</em><em>18</em><em>24</em></span>'; }
    function teamChips(t) {
      var parts = String(t || "").split(/[,;+\n]/).map(function (x) { return x.trim(); }).filter(Boolean);
      return parts.length ? parts.map(function (x) { return '<span>' + esc(x) + '</span>'; }).join("") : '<em>Nobody listed. “Crew needed” is used.</em>';
    }
    function step(i, k, label, val, lo) {
      return '<div class="rsu-stp"><small>' + label + '</small><div><button type="button" data-step="' + i + ':' + k + ':-1" aria-label="Less">' + ico(I.minus) + '</button><b data-val="' + i + ':' + k + '">' + (Number(val) || 0) + '</b><button type="button" data-step="' + i + ':' + k + ':1" aria-label="More">' + ico(I.plus) + '</button></div></div>';
    }
    function card(r, i) {
      var m = minutes(r), c = colorOf(r.color);
      return '<li class="rsu-shift" data-i="' + i + '" style="--c:' + c + ';--t:' + tint(r.color) + '">' +
        '<div class="rsu-s-top"><label class="rsu-badge" title="Shift code"><input data-r="' + i + '" data-k="code" maxlength="4" value="' + esc(r.code) + '" aria-label="Code" placeholder="D"></label>' +
          '<label class="rsu-f grow"><span>Shift name</span><input data-r="' + i + '" data-k="name" maxlength="60" value="' + esc(r.name) + '" placeholder="e.g. Day Shift"></label>' +
          (ctx.canEdit ? '<button type="button" class="rsu-del" data-del="' + i + '" aria-label="Remove shift" title="Remove">' + ico(I.trash) + '</button>' : "") + '</div>' +
        '<div class="rsu-time"><label class="rsu-f"><span>Starts</span><input type="time" data-r="' + i + '" data-k="start" value="' + esc(r.start) + '"></label>' +
          '<div class="rsu-day"><div class="rsu-track" data-bar="' + i + '">' + bar(r) + '</div>' + ticks() + '<p data-dur="' + i + '"><b>' + fmtH(m.len) + '</b>' + ((Number(r.brk) || 0) ? ' · ' + fmtH(m.paid) + ' paid after the break' : "") + '</p></div>' +
          '<label class="rsu-f"><span>Ends</span><input type="time" data-r="' + i + '" data-k="end" value="' + esc(r.end) + '"></label></div>' +
        '<div class="rsu-colors" data-r="' + i + '" data-k="color" role="listbox" aria-label="Colour">' + pal.map(function (n) {
          return '<button type="button" class="rsu-sw' + (String(n) === String(r.color) ? " on" : "") + '" data-v="' + esc(n) + '" title="' + esc(n) + '" style="background:' + colorOf(n) + '" aria-label="' + esc(n) + '"></button>';
        }).join("") + '</div>' +
        '<div class="rsu-row">' + step(i, "needed", "Crew needed / day", r.needed) + step(i, "brk", "Unpaid break (min)", r.brk) +
          '<div class="rsu-seg" data-seg="' + i + '"><small>For</small><div>' + GROUPS.map(function (g) { return '<button type="button" data-g="' + g + '" class="' + ((r.group || "Everyone") === g ? "on" : "") + '">' + g + '</button>'; }).join("") + '</div></div></div>' +
        '<label class="rsu-f rsu-team"><span>Team per shift <small>(replaces “crew needed”, e.g. 1 Captain, 2 Crew)</small></span><input data-r="' + i + '" data-k="team" maxlength="80" value="' + esc(r.team || "") + '" placeholder="1 Captain, 2 Crew, 1 Cashier">' +
          '<div class="rsu-chips" data-team="' + i + '">' + teamChips(r.team) + '</div></label></li>';
    }
    function blank() {
      var used = {}; rows.forEach(function (r) { used[r.color] = 1; });
      return { name: "", code: "", start: "06:00", end: "14:00", color: pal.filter(function (x) { return !used[x]; })[0] || pal[0], needed: 0, brk: 0, group: "Everyone", team: "" };
    }
    function draw() {
      el.innerHTML = '<div class="rsu">' + head(I.clock, "Shift definitions", "Each shift has a code that shows in the roster, a time range, a colour and how many people it needs. Add the shifts your crew works.") +
        '<ul class="rsu-shifts">' + (rows.length ? rows.map(card).join("") : '<li class="rsu-empty">No shifts yet. Add your first shift.</li>') + '</ul>' +
        (ctx.canEdit ? '<button type="button" class="rsu-add" id="rsuAdd">' + ico(I.plus) + 'Add shift</button>' : "") + K.footer(ctx) + '</div>';
      K.lock(el, ctx);
      K.bindSave(ctx, collect);
      var add = document.getElementById("rsuAdd");
      if (add) add.addEventListener("click", function () { if (rows.length >= max) { K.say("Limit of " + max + " shifts.", "err"); return; } rows.push(blank()); draw(); var last = el.querySelectorAll(".rsu-shift"); var f = last[last.length - 1].querySelector('[data-k="code"]'); if (f) f.focus(); });
    }
    function refresh(i) {
      var r = rows[i], card = el.querySelector('.rsu-shift[data-i="' + i + '"]'); if (!card) return;
      card.style.setProperty("--c", colorOf(r.color)); card.style.setProperty("--t", tint(r.color));
      var b = card.querySelector('[data-bar]'); if (b) b.innerHTML = bar(r);
      var m = minutes(r), d = card.querySelector('[data-dur]'); if (d) d.innerHTML = '<b>' + fmtH(m.len) + '</b>' + ((Number(r.brk) || 0) ? ' · ' + fmtH(m.paid) + ' paid after the break' : "");
      var t = card.querySelector('[data-team]'); if (t) t.innerHTML = teamChips(r.team);
      ["needed", "brk"].forEach(function (k) { var v = card.querySelector('[data-val="' + i + ':' + k + '"]'); if (v) v.textContent = Number(r[k]) || 0; });
    }
    listen(el, "input", function (e) {
      var t = e.target; if (!t.dataset || t.dataset.r == null || !t.dataset.k) return;
      var i = +t.dataset.r; rows[i][t.dataset.k] = t.value; refresh(i);
    });
    listen(el, "click", function (e) {
      if (!ctx.canEdit) return;
      var sw = e.target.closest(".rsu-sw"), st = e.target.closest("[data-step]"), g = e.target.closest("[data-g]"), del = e.target.closest("[data-del]");
      if (sw) { var w = sw.parentNode, i = +w.dataset.r; rows[i].color = sw.dataset.v; [].forEach.call(w.children, function (x) { x.classList.toggle("on", x === sw); }); refresh(i); }
      else if (st) { var p = st.dataset.step.split(":"), i2 = +p[0], k = p[1], d = +p[2]; rows[i2][k] = Math.max(0, (Number(rows[i2][k]) || 0) + d * (k === "brk" ? 5 : 1)); refresh(i2); }
      else if (g) { var i3 = +g.closest("[data-seg]").dataset.seg; rows[i3].group = g.dataset.g; [].forEach.call(g.parentNode.children, function (x) { x.classList.toggle("on", x === g); }); }
      else if (del) { rows.splice(+del.dataset.del, 1); draw(); }
    });
    function collect() {
      var seenN = {}, seenC = {};
      return rows.map(function (r, i) {
        var o = {}, name = String(r.name || "").trim(), code = String(r.code || "").trim().toUpperCase();
        if (!name) throw new Error("Give shift " + (i + 1) + " a name.");
        if (!code) throw new Error("Give “" + name + "” a code (1 to 4 letters).");
        if (["OFF", "L", "TRN"].indexOf(code) > -1) throw new Error("“" + code + "” is already used for Off, Leave or Training. Pick another code.");
        if (seenN[name.toLowerCase()]) throw new Error("“" + name + "” appears twice.");
        if (seenC[code]) throw new Error("Code " + code + " is used by two shifts.");
        seenN[name.toLowerCase()] = seenC[code] = 1;
        cols.forEach(function (c) {
          var v = r[c.k];
          if (c.t === "number") { var n = parseFloat(v); o[c.k] = isNaN(n) ? (c.d != null ? c.d : 0) : Math.max(c.min != null ? c.min : 0, n); }
          else o[c.k] = String(v == null ? "" : v).trim();
        });
        o.name = name; o.code = code; return o;
      });
    }
    draw();
  };

  /* ================= Roster Patterns ================= */
  V["Roster Patterns"] = function (el, ctx) {
    var K = kit(), spec = ctx.spec, max = spec.max || 50;
    var rows = (Array.isArray(ctx.value) ? ctx.value : spec.def || []).map(function (r) { return { name: r.name || "", pattern: r.pattern || "", note: r.note || "" }; });
    var sh = shiftsOf(ctx), colorBy = {}; sh.forEach(function (s) { colorBy[String(s.code).toUpperCase()] = s.color; });
    var codes = sh.map(function (s) { return String(s.code).toUpperCase(); }).concat(["OFF", "TRN"]);
    function seq(r) { return String(r.pattern || "").split(",").map(function (x) { return x.trim().toUpperCase(); }).filter(Boolean); }
    function chip(c, i, j) {
      var st = c === "OFF" ? "background:#fde7e9;color:#d64555" : c === "TRN" ? "background:repeating-linear-gradient(135deg,#eef1f6 0 6px,#e3e8f0 6px 12px);color:#52617f" : c === "L" ? "background:#ece7fd;color:#7a5af5"
        : "background:" + (colorOf(colorBy[c]) + "26") + ";color:" + colorOf(colorBy[c]);
      return '<button type="button" class="rsu-pc" style="' + st + '" data-pop="' + i + ':' + j + '" title="Remove day ' + (j + 1) + '">' + esc(c) + '</button>';
    }
    function stats(r) { var s = seq(r), w = s.filter(function (c) { return c !== "OFF" && c !== "L"; }).length; return s.length ? s.length + "-day cycle · " + w + " working, " + (s.length - w) + " off" : "Tap codes below to build the cycle"; }
    function card(r, i) {
      var s = seq(r);
      return '<li class="rsu-pat" data-i="' + i + '"><div class="rsu-p-top"><label class="rsu-f grow"><span>Pattern name</span><input data-r="' + i + '" data-k="name" maxlength="60" value="' + esc(r.name) + '" placeholder="e.g. 5 on, 2 off"></label>' +
        '<label class="rsu-f grow"><span>Good for</span><input data-r="' + i + '" data-k="note" maxlength="80" value="' + esc(r.note) + '" placeholder="optional"></label>' +
        (ctx.canEdit ? '<button type="button" class="rsu-del" data-del="' + i + '" aria-label="Remove pattern">' + ico(I.trash) + '</button>' : "") + '</div>' +
        '<div class="rsu-cycle" data-cycle="' + i + '">' + (s.length ? s.map(function (c, j) { return chip(c, i, j); }).join("") : '<em>Empty</em>') + '</div>' +
        '<p class="rsu-stat" data-stat="' + i + '">' + stats(r) + '</p>' +
        (ctx.canEdit ? '<div class="rsu-palette"><span>Add a day</span>' + codes.map(function (c) { return chip(c, i, -1).replace('data-pop="' + i + ':-1"', 'data-push="' + i + ':' + esc(c) + '"').replace('title="Remove day 0"', 'title="Add ' + esc(c) + '"'); }).join("") +
          '<button type="button" class="rsu-mini" data-rep="' + i + '">Repeat ×2</button><button type="button" class="rsu-mini" data-clr="' + i + '">Clear</button></div>' : "") + '</li>';
    }
    function draw() {
      el.innerHTML = '<div class="rsu">' + head(I.cycle, "Roster patterns", "A pattern is one cycle of shift codes that repeats across a period. Apply it to crew from the roster's Templates tab.") +
        '<ul class="rsu-pats">' + (rows.length ? rows.map(card).join("") : '<li class="rsu-empty">No patterns yet.</li>') + '</ul>' +
        (ctx.canEdit ? '<button type="button" class="rsu-add" id="rsuAdd">' + ico(I.plus) + 'Add pattern</button>' : "") + K.footer(ctx) + '</div>';
      K.lock(el, ctx); K.bindSave(ctx, collect);
      var add = document.getElementById("rsuAdd");
      if (add) add.addEventListener("click", function () { if (rows.length >= max) { K.say("Limit of " + max + " patterns.", "err"); return; } rows.push({ name: "", pattern: "", note: "" }); draw(); var l = el.querySelectorAll(".rsu-pat"); l[l.length - 1].querySelector("input").focus(); });
    }
    function redraw(i) {
      var r = rows[i], s = seq(r), cy = el.querySelector('[data-cycle="' + i + '"]'), st = el.querySelector('[data-stat="' + i + '"]');
      if (cy) cy.innerHTML = s.length ? s.map(function (c, j) { return chip(c, i, j); }).join("") : "<em>Empty</em>"; if (st) st.textContent = stats(r);
    }
    listen(el, "input", function (e) { var t = e.target; if (t.dataset && t.dataset.r != null) rows[+t.dataset.r][t.dataset.k] = t.value; });
    listen(el, "click", function (e) {
      if (!ctx.canEdit) return;
      var push = e.target.closest("[data-push]"), pop = e.target.closest("[data-pop]"), rep = e.target.closest("[data-rep]"), clr = e.target.closest("[data-clr]"), del = e.target.closest("[data-del]");
      if (push) { var p = push.dataset.push.split(":"), i = +p[0], s = seq(rows[i]); if (s.length >= 60) { K.say("A cycle can be up to 60 days.", "err"); return; } s.push(p[1]); rows[i].pattern = s.join(","); redraw(i); }
      else if (pop) { var q = pop.dataset.pop.split(":"), i2 = +q[0], s2 = seq(rows[i2]); s2.splice(+q[1], 1); rows[i2].pattern = s2.join(","); redraw(i2); }
      else if (rep) { var i3 = +rep.dataset.rep, s3 = seq(rows[i3]); if (s3.length && s3.length * 2 <= 60) { rows[i3].pattern = s3.concat(s3).join(","); redraw(i3); } }
      else if (clr) { rows[+clr.dataset.clr].pattern = ""; redraw(+clr.dataset.clr); }
      else if (del) { rows.splice(+del.dataset.del, 1); draw(); }
    });
    function collect() {
      var seen = {};
      return rows.map(function (r, i) {
        var name = String(r.name || "").trim(); if (!name) throw new Error("Give pattern " + (i + 1) + " a name.");
        if (seen[name.toLowerCase()]) throw new Error("“" + name + "” appears twice."); seen[name.toLowerCase()] = 1;
        if (!seq(r).length) throw new Error("“" + name + "” has no shift codes yet.");
        return { name: name, pattern: seq(r).join(","), note: String(r.note || "").trim() };
      });
    }
    draw();
  };

  /* ================= forms (swap rules, roster options, duty hours) ================= */
  function formView(ctx) {
    var saved = ctx.value && typeof ctx.value === "object" && !Array.isArray(ctx.value) ? ctx.value : {}, vals = {};
    ctx.spec.fields.forEach(function (f) { vals[f.k] = saved[f.k] != null ? saved[f.k] : f.d; });
    return { vals: vals, fields: ctx.spec.fields, field: function (k) { return ctx.spec.fields.filter(function (f) { return f.k === k; })[0]; } };
  }
  function toggle(F, k, title, text) {
    return '<button type="button" class="rsu-tog' + (F.vals[k] ? " on" : "") + '" data-tg="' + k + '" role="switch" aria-checked="' + !!F.vals[k] + '"><span class="tx"><strong>' + esc(title) + '</strong><small>' + esc(text) + '</small></span><i class="knob"></i></button>';
  }
  function segment(F, k, title, opts) {
    return '<div class="rsu-opt"><h4>' + esc(title) + '</h4><div class="rsu-cards">' + opts.map(function (o) {
      return '<button type="button" class="' + (String(F.vals[k]) === o[0] ? "on" : "") + '" data-sg="' + k + '" data-v="' + esc(o[0]) + '"><strong>' + esc(o[0]) + '</strong>' + (o[1] ? '<small>' + esc(o[1]) + '</small>' : "") + (o[2] || "") + '</button>';
    }).join("") + '</div></div>';
  }
  function bindForm(el, ctx, F, draw, out) {
    var K = kit();
    function collect() {
      var o = {};
      F.fields.forEach(function (f) {
        var v = F.vals[f.k];
        if (f.t === "number") { var n = parseFloat(v), lo = f.min != null ? f.min : 0; if (isNaN(n) || n < lo) throw new Error(f.l + " must be a number, " + lo + " or more."); if (f.max != null && n > f.max) throw new Error(f.l + " must be " + f.max + " or less."); o[f.k] = n; }
        else if (f.t === "toggle") o[f.k] = !!v; else o[f.k] = String(v == null ? "" : v);
      });
      return o;
    }
    function redraw() { draw(); K.bindSave(ctx, collect); }
    listen(el, "click", function (e) {
      if (!ctx.canEdit) return;
      var tg = e.target.closest("[data-tg]"), sg = e.target.closest("[data-sg]"), st = e.target.closest("[data-fstep]");
      if (tg) { F.vals[tg.dataset.tg] = !F.vals[tg.dataset.tg]; redraw(); }
      else if (sg) { F.vals[sg.dataset.sg] = sg.dataset.v; redraw(); }
      else if (st) { var p = st.dataset.fstep.split(":"), f = F.field(p[0]), lo = f.min != null ? f.min : 0, hi = f.max != null ? f.max : 999; F.vals[p[0]] = Math.min(hi, Math.max(lo, (Number(F.vals[p[0]]) || 0) + +p[1])); redraw(); }
    });
    listen(el, "input", function (e) {
      var t = e.target; if (!t.dataset || !t.dataset.fr) return;
      F.vals[t.dataset.fr] = Number(t.value);
      var live = el.querySelector('[data-live="' + t.dataset.fr + '"]'); if (live) live.textContent = F.vals[t.dataset.fr];
      var sm = el.querySelector("[data-sum]"); if (sm) sm.innerHTML = out.sum();
    });
    K.bindSave(ctx, collect);
  }

  // ---- Shift Swap Rules ----
  V["Shift Swap Rules"] = function (el, ctx) {
    var K = kit(), F = formView(ctx);
    function sum() {
      if (!F.vals.enabled) return "Shift swaps are <b>off</b>. Staff cannot ask a colleague to swap.";
      var who = { "Anyone": "any colleague", "Same designation": "a colleague with the same designation", "Same crew group": "a colleague in the same crew group" }[F.vals.scope] || "a colleague";
      return "Staff can ask " + who + " to swap a shift. The colleague must accept first" + (F.vals.hod ? ", then it goes for approval" : ", and the roster changes straight away") + "." + (Number(F.vals.notice) ? " It must be asked at least <b>" + Number(F.vals.notice) + " hour" + (Number(F.vals.notice) === 1 ? "" : "s") + "</b> before the shift." : "");
    }
    function draw() {
      el.innerHTML = '<div class="rsu">' + head(I.swap, "Shift swaps", "Staff asking a colleague to swap a day's shift (iOS and Android: Quick access → Shift change).") +
        '<div class="rsu-sum" data-sum>' + sum() + '</div>' +
        toggle(F, "enabled", "Allow shift swap requests", "Turn off to hide the Shift change option in the apps.") +
        '<div class="rsu-dim' + (F.vals.enabled ? "" : " off") + '">' +
          segment(F, "scope", "Staff can swap with", [["Anyone", "Every active colleague"], ["Same designation", "Same job title, e.g. Deckhand"], ["Same crew group", "Captain, Deck, Engineering…"]]) +
          toggle(F, "hod", "Swaps need approval after the colleague accepts", "A manager or HR approves before the roster changes.") +
          '<div class="rsu-opt"><h4>Minimum notice before the shift</h4><div class="rsu-num"><button type="button" data-fstep="notice:-1" aria-label="Less">' + ico(I.minus) + '</button><b><span data-live="notice">' + (Number(F.vals.notice) || 0) + '</span><small> hours</small></b><button type="button" data-fstep="notice:1" aria-label="More">' + ico(I.plus) + '</button></div></div>' +
        '</div>' + K.footer(ctx) + '</div>';
      K.lock(el, ctx);
    }
    draw(); var out = { sum: sum };
    bindForm(el, ctx, F, draw, out);
  };

  // ---- Duty Roster options ----
  V["Duty Roster"] = function (el, ctx) {
    var K = kit(), F = formView(ctx), DOW = ["Sun", "Mon", "Tue", "Wed", "Thu", "Fri", "Sat"];
    function weekend(v) { return v === "Friday & Saturday" ? [5, 6] : v === "Saturday & Sunday" ? [6, 0] : v === "Friday only" ? [5] : []; }
    function strip(v) { var w = weekend(v); return '<span class="rsu-wk">' + [1, 2, 3, 4, 5, 6, 0].map(function (d) { return '<i class="' + (w.indexOf(d) > -1 ? "we" : "") + '">' + DOW[d].charAt(0) + '</i>'; }).join("") + '</span>'; }
    function draw() {
      el.innerHTML = '<div class="rsu">' + head(I.cal, "Roster options", "How the Duty Roster page looks and which rules warn you while you plan.") +
        segment(F, "weekend", "Weekend days", ["Friday & Saturday", "Saturday & Sunday", "Friday only", "None"].map(function (o) { return [o, "", strip(o)]; })) +
        segment(F, "view", "Default view", [["Week", "Fastest to load"], ["Two weeks", ""], ["Month", "Full calendar"]]) +
        '<div class="rsu-group"><h4>Display</h4>' + toggle(F, "showLeave", "Show approved leave as L automatically", "Leave appears in the grid without anyone entering it.") + toggle(F, "lockPast", "Lock past days", "Changes to days before today are refused.") + '</div>' +
        '<div class="rsu-group"><h4>Warnings while planning</h4>' + toggle(F, "warnRest", "Rest between shifts is too short", "Uses the minimum rest in Duty hours.") +
          toggle(F, "warnConsecutive", "Too many working days in a row", "Uses the maximum consecutive days in Duty hours.") + toggle(F, "warnWeekly", "Weekly hours are over the limit", "Uses the weekly maximum in Duty hours.") + '</div>' + K.footer(ctx) + '</div>';
      K.lock(el, ctx);
    }
    draw(); bindForm(el, ctx, F, draw, { sum: function () { return ""; } });
  };

  // ---- Duty Hours ----
  V["Duty Hours"] = function (el, ctx) {
    var K = kit(), F = formView(ctx);
    var DEF = { daily: ["Maximum daily duty", "hours", 1, 24, "The longest a person can be on duty in one day."], weekly: ["Maximum weekly duty", "hours", 1, 168, "Total duty hours in a week."],
      rest: ["Minimum daily rest", "hours", 0, 24, "Rest needed between two shifts."], consecutive: ["Maximum consecutive days", "days", 1, 14, "Working days allowed in a row before a day off."] };
    function sum() {
      var d = Number(F.vals.daily) || 0, w = Number(F.vals.weekly) || 0, r = Number(F.vals.rest) || 0, c = Number(F.vals.consecutive) || 0;
      var warn = d + r > 24 ? "<b>Check:</b> a " + d + "h duty plus " + r + "h rest is more than 24 hours. " : "";
      return warn + "Up to <b>" + d + "h a day</b>, <b>" + w + "h a week</b>, <b>" + r + "h rest</b> between shifts and <b>" + c + " days</b> in a row.";
    }
    function gauge(k) {
      var f = F.field(k), m = DEF[k], v = Number(F.vals[k]) || 0, lo = Math.max(m[2], f.min != null ? f.min : 0), hi = f.max != null ? Math.min(f.max, m[3]) : m[3];
      return '<div class="rsu-gauge"><div class="gt"><span class="ic">' + ico(I.gauge) + '</span><div><strong>' + m[0] + '</strong><small>' + m[4] + '</small></div></div>' +
        '<div class="gv"><button type="button" data-fstep="' + k + ':-1" aria-label="Less">' + ico(I.minus) + '</button><b><span data-live="' + k + '">' + v + '</span><small> ' + m[1] + '</small></b><button type="button" data-fstep="' + k + ':1" aria-label="More">' + ico(I.plus) + '</button></div>' +
        '<input type="range" data-fr="' + k + '" min="' + lo + '" max="' + hi + '" step="1" value="' + v + '" aria-label="' + m[0] + '"></div>';
    }
    function draw() {
      el.innerHTML = '<div class="rsu">' + head(I.gauge, "Duty hours", "Daily and weekly limits, rest and days in a row. The roster warns (or blocks, in Crew Assignment Rules) when these are broken.") +
        '<div class="rsu-sum" data-sum>' + sum() + '</div><div class="rsu-gauges">' + ["daily", "weekly", "rest", "consecutive"].map(gauge).join("") + '</div>' + K.footer(ctx) + '</div>';
      K.lock(el, ctx);
    }
    draw(); bindForm(el, ctx, F, draw, { sum: sum });
  };
})();
