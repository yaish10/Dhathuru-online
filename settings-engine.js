/* Renders and saves one settings item. Used by the company Settings page and the Platform owner console. */
(function () {
  function esc(v) { return String(v == null ? "" : v).replace(/[&<>"']/g, function (c) { return { "&": "&amp;", "<": "&lt;", ">": "&gt;", '"': "&quot;", "'": "&#39;" }[c]; }); }
  function clone(v) { return JSON.parse(JSON.stringify(v)); }
  function slug(t) { return t.toLowerCase().replace(/&/g, "and").replace(/[^a-z0-9]+/g, "_").replace(/^_|_$/g, "").slice(0, 48); }

  function header(ctx) {
    if (ctx.embed) return "";
    var note = (ctx.spec && ctx.spec.note) || "";
    return '<div class="ed-head"><button type="button" class="back" data-back>← ' + esc(ctx.backLabel || "Back") + '</button>' +
      (ctx.backLabel ? '<p class="ed-kicker">' + esc(ctx.backLabel) + '</p>' : "") +
      '<h2>' + esc(ctx.title) + '</h2></div>' +
      (ctx.help ? '<p class="purpose">' + esc(ctx.help) + '</p>' : "") +
      ((note && note !== ctx.help) || !ctx.help ? '<p class="note">' + esc(note || ctx.hint || "") + '</p>' : "");
  }
  function footer(ctx) {
    if (!ctx.canEdit) return '<p class="msg" id="itemMsg">Only owners and admins can change this setting.</p>';
    return '<div class="ed-foot actions"><span class="msg" id="itemMsg" role="status"></span><button class="save" type="button" id="itemSave"><svg viewBox="0 0 24 24"><path d="m5 12 5 5 9-10"/></svg>Save changes</button></div>';
  }
  function say(t, k) { var m = document.getElementById("itemMsg"); if (m) { m.textContent = t; m.className = "msg " + (k || ""); } }
  function lock(el, ctx) {
    if (ctx.canEdit) return;
    [].forEach.call(el.querySelectorAll("input, select, textarea, button:not([data-back])"), function (e) { e.disabled = true; });
  }
  function bindSave(ctx, collect) {
    var b = document.getElementById("itemSave"); if (!b) return;
    b.addEventListener("click", function () {
      var val; try { val = collect(); } catch (e) { say(e.message, "err"); return; }
      b.disabled = true; say("Saving…");
      Promise.resolve(ctx.save(val)).then(function () { say("Saved.", "ok"); }).catch(function (e) { say(e.message || "Could not save.", "err"); }).then(function () { b.disabled = false; });
    });
  }

  /* ---------- list ---------- */
  function renderList(el, ctx) {
    var saved = ctx.value;
    var items = Array.isArray(saved) ? clone(saved) : clone(ctx.spec.def || []);
    function draw() {
      el.innerHTML = header(ctx) +
        '<ul class="chips" id="chips">' + items.map(function (t, i) { return '<li class="chip"><span>' + esc(t) + '</span>' + (ctx.canEdit ? '<button type="button" data-rm="' + i + '" aria-label="Remove">×</button>' : "") + '</li>'; }).join("") + (items.length ? "" : '<li class="note">Nothing added yet.</li>') + '</ul>' +
        (ctx.canEdit ? '<div class="inv"><input id="addText" placeholder="Add an entry" maxlength="120" aria-label="New entry"><button type="button" class="ghost" id="addBtn">Add</button></div>' : "") + footer(ctx);
      lock(el, ctx);
      var add = function () { var i = document.getElementById("addText"), v = i.value.trim(); if (!v) return; if (items.length >= 200) { say("Limit of 200 entries.", "err"); return; } if (items.indexOf(v) > -1) { say("Already in the list.", "err"); return; } items.push(v); draw(); document.getElementById("addText").focus(); };
      var ab = document.getElementById("addBtn"); if (ab) { ab.addEventListener("click", add); document.getElementById("addText").addEventListener("keydown", function (e) { if (e.key === "Enter") { e.preventDefault(); add(); } }); }
      [].forEach.call(el.querySelectorAll("[data-rm]"), function (b) { b.addEventListener("click", function () { items.splice(Number(b.dataset.rm), 1); draw(); }); });
      bindSave(ctx, function () { return items; });
    }
    draw();
  }


  /* ---------- table (rows of fields; the first column is the row's unique name) ---------- */
  function renderTable(el, ctx) {
    var spec = ctx.spec, cols = spec.cols, max = spec.max || 50;
    var src = Array.isArray(ctx.value) ? ctx.value : spec.def || [];
    var rows = src.map(function (r) {
      if (typeof r === "string") { var o = {}; o[cols[0].k] = r; return o; }
      return clone(r);
    });
    function blank() {
      var o = {};
      cols.forEach(function (c) {
        if (c.t === "color") {
          var pal = c.o || window.VEYORA_SHIFT_COLORS || [];
          var used = {};
          rows.forEach(function (r) { used[r[c.k]] = true; });
          o[c.k] = pal.filter(function (x) { return !used[x]; })[0] || pal[rows.length % Math.max(pal.length, 1)] || c.d || pal[0] || "";
        } else o[c.k] = c.d != null ? c.d : c.t === "toggle" ? false : "";
      });
      return o;
    }
    function cell(c, r, i) {
      var v = r[c.k] == null ? (c.d != null ? c.d : "") : r[c.k], a = ' data-r="' + i + '" data-k="' + c.k + '" aria-label="' + esc(c.l) + '"';
      if (c.t === "toggle") return '<button type="button" class="sw" role="switch"' + a + ' aria-checked="' + !!v + '"></button>';
      if (c.t === "color") {
        var pal = c.o || window.VEYORA_SHIFT_COLORS || [];
        var cur = v || c.d || pal[0];
        return '<div class="swatches" data-r="' + i + '" data-k="' + c.k + '" role="listbox" aria-label="' + esc(c.l) + '">' + pal.map(function (name) {
          var on = String(name) === String(cur);
          return '<button type="button" class="swatch c-' + String(name).toLowerCase() + (on ? " on" : "") + '" data-v="' + esc(name) + '" title="' + esc(name) + '" aria-label="' + esc(name) + '" aria-selected="' + on + '"></button>';
        }).join("") + '</div>';
      }
      if (c.t === "select") return '<select' + a + '>' + c.o.map(function (o) { return '<option' + (String(o) === String(v) ? " selected" : "") + '>' + esc(o) + '</option>'; }).join("") + '</select>';
      return '<input' + a + ' type="' + (c.t === "number" ? "number" : c.t === "time" ? "time" : "text") + '"' + (c.t === "number" ? ' step="any" min="' + (c.min != null ? c.min : 0) + '"' : ' maxlength="80"') + ' value="' + esc(v) + '"' + (c.w ? ' style="width:' + c.w + 'px"' : "") + '>';
    }
    function field(c, r, i) {
      return '<label class="shift-f"><span>' + esc(c.l) + '</span>' + cell(c, r, i) + '</label>';
    }
    function card(r, i) {
      var colorCol = cols.filter(function (c) { return c.t === "color"; })[0];
      var main = cols.filter(function (c) { return c.t !== "color" && c.k !== "needed" && c.k !== "brk" && c.k !== "group"; });
      var extra = cols.filter(function (c) { return c.k === "needed" || c.k === "brk" || c.k === "group"; });
      return '<li class="shift-card">' +
        '<div class="shift-top">' + main.map(function (c) { return field(c, r, i); }).join("") +
        (ctx.canEdit ? '<button type="button" class="ghost danger" data-del="' + i + '" aria-label="Remove row">Remove</button>' : "") + '</div>' +
        (colorCol ? '<div class="shift-colors"><span>Colour</span>' + cell(colorCol, r, i) + '</div>' : "") +
        (extra.length ? '<div class="shift-meta">' + extra.map(function (c) { return field(c, r, i); }).join("") + '</div>' : "") +
      '</li>';
    }
    function draw() {
      var asCards = cols.some(function (c) { return c.t === "color"; });
      var body = asCards
        ? (rows.length ? '<ul class="shift-cards">' + rows.map(card).join("") + '</ul>' : '<p class="note">Nothing added yet.</p>')
        : '<div class="mx-wrap"><table class="mx tbl tedit"><thead><tr>' + cols.map(function (c) { return '<th>' + esc(c.l) + '</th>'; }).join("") + '<th></th></tr></thead><tbody>' +
          (rows.length ? rows.map(function (r, i) {
            return '<tr>' + cols.map(function (c) { return '<td>' + cell(c, r, i) + '</td>'; }).join("") + '<td>' + (ctx.canEdit ? '<button type="button" class="ghost danger" data-del="' + i + '" aria-label="Remove row">Remove</button>' : "") + '</td></tr>';
          }).join("") : '<tr><td colspan="' + (cols.length + 1) + '" class="note">Nothing added yet.</td></tr>') + '</tbody></table></div>';
      el.innerHTML = header(ctx) + body +
        (ctx.canEdit ? '<button type="button" class="add-row" id="tAdd">+ Add ' + esc(spec.rowLabel || "row") + '</button>' : "") + footer(ctx);
      lock(el, ctx);
      [].forEach.call(el.querySelectorAll(".swatches"), function (wrap) {
        wrap.addEventListener("click", function (e) {
          var b = e.target.closest(".swatch"); if (!b) return;
          rows[Number(wrap.dataset.r)][wrap.dataset.k] = b.dataset.v;
          [].forEach.call(wrap.querySelectorAll(".swatch"), function (x) {
            var on = x === b; x.classList.toggle("on", on); x.setAttribute("aria-selected", on);
          });
        });
      });
      [].forEach.call(el.querySelectorAll("[data-r]"), function (inp) {
        if (inp.classList.contains("swatches")) return;
        var r = Number(inp.dataset.r), k = inp.dataset.k;
        if (inp.classList.contains("sw")) inp.addEventListener("click", function () { var on = inp.getAttribute("aria-checked") !== "true"; inp.setAttribute("aria-checked", on); rows[r][k] = on; });
        else inp.addEventListener(inp.tagName === "SELECT" ? "change" : "input", function () { rows[r][k] = inp.type === "number" ? (inp.value === "" ? "" : parseFloat(inp.value)) : inp.value; });
      });
      [].forEach.call(el.querySelectorAll("[data-del]"), function (b) { b.addEventListener("click", function () { rows.splice(Number(b.dataset.del), 1); draw(); }); });
      var add = document.getElementById("tAdd");
      if (add) add.addEventListener("click", function () {
        if (rows.length >= max) { say("Limit of " + max + " rows.", "err"); return; }
        rows.push(blank()); draw();
        var cards = el.querySelectorAll(".shift-card");
        var ins = (cards.length ? cards[cards.length - 1] : el.querySelector("tbody tr:last-child"));
        var first = ins && ins.querySelector("input"); if (first) first.focus();
      });
      bindSave(ctx, function () {
        var seen = {};
        return rows.map(function (r, i) {
          var out = {};
          cols.forEach(function (c) {
            var v = r[c.k];
            if (c.t === "number") { var n = parseFloat(v); if (isNaN(n)) n = c.d != null ? c.d : 0; if (n < (c.min != null ? c.min : 0)) throw new Error(c.l + " on row " + (i + 1) + " must be " + (c.min || 0) + " or more."); out[c.k] = n; }
            else if (c.t === "toggle") out[c.k] = !!v;
            else out[c.k] = String(v == null ? "" : v).trim();
          });
          var name = out[cols[0].k];
          if (!name) throw new Error(cols[0].l + " is required on row " + (i + 1) + ".");
          if (seen[name.toLowerCase()]) throw new Error('"' + name + '" appears twice.');
          seen[name.toLowerCase()] = true;
          return out;
        });
      });
    }
    draw();
  }

  /* ---------- form ---------- */
  function fieldHtml(f, v) {
    var id = "ff_" + f.k, lab = '<label for="' + id + '">' + esc(f.l) + (f.u ? ' <small>(' + esc(f.u) + ')</small>' : "") + '</label>';
    if (f.t === "toggle") return '<div class="fld tog"><span>' + esc(f.l) + '</span><button type="button" class="sw" role="switch" id="' + id + '" aria-checked="' + !!v + '" aria-label="' + esc(f.l) + '"></button></div>';
    if (f.t === "select") return '<div class="fld">' + lab + '<select id="' + id + '">' + f.o.map(function (o) { return '<option' + (String(o) === String(v) ? " selected" : "") + '>' + esc(o) + '</option>'; }).join("") + '</select></div>';
    if (f.t === "textarea") return '<div class="fld wide">' + lab + '<textarea id="' + id + '" rows="3" maxlength="2000">' + esc(v) + '</textarea></div>';
    // Cursor 2026-10-27: password fields stay blank on screen; leave empty on save to keep the stored value.
    if (f.t === "password") return '<div class="fld">' + lab + '<input id="' + id + '" type="password" autocomplete="off" maxlength="80" value="" placeholder="' + esc(v ? "Saved — type a new key to replace" : (f.ph || "")) + '"></div>';
    return '<div class="fld">' + lab + '<input id="' + id + '" type="' + (f.t === "number" ? "number" : f.t === "time" ? "time" : "text") + '" ' + (f.t === "number" ? 'step="any" min="0"' : 'maxlength="200"') + ' value="' + esc(v) + '"' + (f.ph ? ' placeholder="' + esc(f.ph) + '"' : "") + '></div>';
  }
  function renderForm(el, ctx) {
    var saved = ctx.value && typeof ctx.value === "object" && !Array.isArray(ctx.value) ? ctx.value : {};
    var fields = ctx.spec.fields;
    el.innerHTML = header(ctx) + '<div class="cards">' + fields.map(function (f) { return fieldHtml(f, saved[f.k] != null ? saved[f.k] : f.d); }).join("") + '</div>' + footer(ctx);
    [].forEach.call(el.querySelectorAll(".sw"), function (b) { b.addEventListener("click", function () { b.setAttribute("aria-checked", b.getAttribute("aria-checked") !== "true"); }); });
    lock(el, ctx);
    bindSave(ctx, function () {
      var out = {};
      fields.forEach(function (f) {
        var e = document.getElementById("ff_" + f.k);
        if (f.t === "toggle") out[f.k] = e.getAttribute("aria-checked") === "true";
        else if (f.t === "number") { var num = parseFloat(e.value), lo = f.min != null ? f.min : 0; if (isNaN(num) || num < lo) throw new Error(f.l + " must be a number, " + lo + " or more."); if (f.max != null && num > f.max) throw new Error(f.l + " must be " + f.max + " or less."); out[f.k] = num; }
        else if (f.t === "password") out[f.k] = e.value.trim() || String(saved[f.k] || "");
        else out[f.k] = e.value.trim();
      });
      return out;
    });
  }

  /* ---------- matrix ---------- */
  function renderMatrix(el, ctx) {
    var spec = ctx.spec, saved = ctx.value && typeof ctx.value === "object" ? ctx.value : null;
    var rows = spec.rows.slice();
    if (spec.roles && Array.isArray(ctx.customRoles)) {
      ctx.customRoles.forEach(function (name) { if (rows.indexOf(name) === -1) rows.push(name); });
    }
    function val(r, c) { return saved ? !!(saved[r] && saved[r][c]) : !!spec.def(r, c); }
    el.innerHTML = header(ctx) + '<div class="mx-wrap"><table class="mx"><thead><tr><th></th>' + spec.cols.map(function (c) { return '<th>' + esc(c) + '</th>'; }).join("") + '</tr></thead><tbody>' +
      rows.map(function (r) { return '<tr><th scope="row">' + esc(r) + '</th>' + spec.cols.map(function (c) { return '<td><input type="checkbox" data-r="' + esc(r) + '" data-c="' + esc(c) + '"' + (val(r, c) ? " checked" : "") + ' aria-label="' + esc(r + " – " + c) + '"></td>'; }).join("") + '</tr>'; }).join("") +
      '</tbody></table></div>' + footer(ctx);
    lock(el, ctx);
    bindSave(ctx, function () {
      var out = {}; [].forEach.call(el.querySelectorAll("input[type=checkbox]"), function (i) { (out[i.dataset.r] = out[i.dataset.r] || {})[i.dataset.c] = i.checked; }); return out;
    });
  }

  /* ---------- company columns ---------- */
  function renderCompany(el, ctx) {
    var c = ctx.company;
    el.innerHTML = header(ctx) + '<div class="cards">' + ctx.spec.cols.map(function (col) {
      var id = "cc_" + col[0], v = c[col[0]] == null ? "" : c[col[0]], lab = '<label for="' + id + '">' + esc(col[1]) + '</label>';
      if (col[2] === "select") return '<div class="fld">' + lab + '<select id="' + id + '">' + col[3].map(function (o) { return '<option' + (o === v ? " selected" : "") + '>' + esc(o) + '</option>'; }).join("") + '</select></div>';
      if (col[2] === "textarea") return '<div class="fld wide">' + lab + '<textarea id="' + id + '" rows="3">' + esc(v) + '</textarea></div>';
      return '<div class="fld">' + lab + '<input id="' + id + '" type="' + col[2] + '" value="' + esc(v) + '"></div>';
    }).join("") + '</div>' + footer(ctx);
    lock(el, ctx);
    bindSave(ctx, function () {
      var out = {};
      ctx.spec.cols.forEach(function (col) { var v = document.getElementById("cc_" + col[0]).value.trim(); out[col[0]] = v || null; });
      if (out.name !== undefined && (!out.name || out.name.length < 2)) throw new Error("Enter the company name.");
      if (out.email && !/^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(out.email)) throw new Error("Enter a valid email, or leave it blank.");
      return out;
    });
  }

  /* ---------- special views ---------- */
  function renderStatus(el, ctx) {
    var st = ctx.company.status;
    el.innerHTML = header(ctx) + '<div class="cards"><div class="fld"><label>Current status</label><input value="' + esc(st) + '" readonly></div><div class="fld"><label>Company ID</label><input value="' + esc(ctx.company.code) + '" readonly></div></div>' +
      '<p class="note">' + (st === "Active" ? "Your company is active." : st === "Pending" ? "Waiting for approval by the KAHDHU platform owner." : "Your company is suspended. Contact the KAHDHU platform owner.") + ' Only the platform owner can change company status.</p>';
  }
  function renderInfo(el, ctx) { el.innerHTML = header(ctx) + '<div class="empty">' + esc(ctx.spec.text) + '</div>'; }

  function renderAudit(el, ctx) {
    el.innerHTML = header(ctx) + '<p class="msg">Loading…</p>';
    ctx.loadAudit().then(function (rows) {
      el.innerHTML = header(ctx) + '<ul class="rows">' + (rows.length ? rows.map(function (r) {
        return '<li class="row"><span class="grow"><strong>' + esc(String(r.action).replace(/_/g, " ")) + '</strong><small>' + esc(r.detail || "") + (r.by ? " · " + esc(r.by) : "") + " · " + new Date(r.created_at).toLocaleString() + '</small></span></li>';
      }).join("") : '<li class="row"><small>No entries yet.</small></li>') + '</ul>';
    }).catch(function (e) { el.innerHTML = header(ctx) + '<p class="msg err">' + esc(e.message) + '</p>'; });
  }

  function renderSessions(el, ctx) {
    el.innerHTML = header(ctx) + '<p class="msg">Loading…</p>';
    ctx.db.auth.getSession().then(function (r) {
      var s = r.data.session, u = s && s.user;
      el.innerHTML = header(ctx) + '<ul class="rows"><li class="row"><span class="av">●</span><span class="grow"><strong>This device (current)</strong><small>' + esc(u ? u.email : "") + ' · signed in ' + (u && u.last_sign_in_at ? new Date(u.last_sign_in_at).toLocaleString() : "") + ' · ' + esc(navigator.userAgent.slice(0, 80)) + '</small></span></li></ul>' +
        '<div class="actions"><button type="button" class="ghost danger" id="outAll">Sign out of all devices</button></div>';
      document.getElementById("outAll").addEventListener("click", function () {
        if (confirm("Sign out everywhere, including this device?")) ctx.db.auth.signOut({ scope: "global" }).then(function () { location.replace("index.html"); });
      });
    });
  }

  function renderExport(el, ctx) {
    el.innerHTML = header(ctx) + '<p class="note">Download this company\'s profile and all settings as a JSON file.</p><div class="actions"><button type="button" class="save" id="dl">Download export</button></div>';
    document.getElementById("dl").addEventListener("click", function () {
      var c = ctx.company, data = { exportedAt: new Date().toISOString(), company: { name: c.name, type: c.type, region: c.region, email: c.email, phone: c.phone, currency: c.currency, timezone: c.timezone, date_format: c.date_format, language: c.language, registration_no: c.registration_no, address: c.address }, settings: ctx.allSettings() };
      var a = document.createElement("a"); a.href = URL.createObjectURL(new Blob([JSON.stringify(data, null, 2)], { type: "application/json" })); a.download = "veyora-" + (c.code || "company") + "-export.json"; a.click(); setTimeout(function () { URL.revokeObjectURL(a.href); }, 1000);
    });
  }

  function renderImport(el, ctx) {
    el.innerHTML = header(ctx) + '<p class="note">Restore settings from a KAHDHU export file. Existing values for the same settings are replaced.</p>' +
      '<div class="inv"><input type="file" id="impFile" accept="application/json,.json"><button type="button" class="save" id="impGo">Import settings</button></div><p class="msg" id="itemMsg"></p>';
    lock(el, ctx);
    document.getElementById("impGo").addEventListener("click", function () {
      var f = document.getElementById("impFile").files[0]; if (!f) { say("Choose a file first.", "err"); return; }
      if (f.size > 1000000) { say("That file is too large.", "err"); return; }
      f.text().then(function (txt) {
        var obj = JSON.parse(txt), st = obj && (obj.settings || obj);
        if (!st || typeof st !== "object" || Array.isArray(st)) throw new Error("This is not a KAHDHU export file.");
        var keys = Object.keys(st).filter(function (k) { return /^[a-z0-9_]{1,60}$/.test(k); });
        if (!keys.length) throw new Error("No settings found in that file.");
        if (keys.length > 400) throw new Error("Too many settings in that file.");
        say("Importing " + keys.length + " settings…");
        return keys.reduce(function (p, k) { return p.then(function () { return ctx.saveKey(k, st[k]); }); }, Promise.resolve()).then(function () { say("Imported " + keys.length + " settings.", "ok"); });
      }).catch(function (e) { say(e.message || "Could not import.", "err"); });
    });
  }

  /* Cash booking approval: people, designations and departments, any one or everyone. */
  function renderArrivalApproval(el, ctx) {
    var saved = ctx.value && typeof ctx.value === "object" && !Array.isArray(ctx.value) ? ctx.value : {};
    var cfg = {
      required: saved.required === true,
      mode: saved.mode === "all" ? "all" : "any",
      people: Array.isArray(saved.people) ? saved.people.slice() : [],
      designations: Array.isArray(saved.designations) ? saved.designations.slice() : [],
      departments: Array.isArray(saved.departments) ? saved.departments.slice() : []
    };
    var q = "";
    el.innerHTML = header(ctx) + '<p class="msg">Loading people…</p>';
    var company = ctx.company, db = ctx.db;
    if (!company || !db) { el.innerHTML = header(ctx) + '<p class="msg err">Company details are not loaded.</p>'; return; }
    Promise.all([
      db.from("company_members").select("user_id, role, active, department_id, job_title_id").eq("company_id", company.id),
      db.from("departments").select("id, name, active").eq("company_id", company.id).order("name"),
      db.from("job_titles").select("id, title, active").eq("company_id", company.id).order("title")
    ]).then(function (rows) {
      for (var i = 0; i < rows.length; i++) if (rows[i].error) throw new Error(rows[i].error.message);
      var members = rows[0].data || [], depts = rows[1].data || [], titles = rows[2].data || [];
      var titleById = {}; titles.forEach(function (t) { titleById[t.id] = t.title; });
      var ids = members.map(function (m) { return m.user_id; }).filter(Boolean);
      var names = ids.length ? db.from("profiles").select("id, full_name, email").in("id", ids) : Promise.resolve({ data: [] });
      return names.then(function (p) {
        if (p.error) throw new Error(p.error.message);
        var by = {}; (p.data || []).forEach(function (x) { by[x.id] = x; });
        var people = members.filter(function (m) { return m.active; }).map(function (m) {
          var prof = by[m.user_id] || {};
          var role = titleById[m.job_title_id] || (m.role ? m.role.charAt(0).toUpperCase() + m.role.slice(1) : "Staff");
          return { id: m.user_id, name: prof.full_name || (prof.email || "").split("@")[0] || "Unknown", role: role };
        }).sort(function (a, b) { return a.name.localeCompare(b.name); });
        draw(people, depts, titles);
      });
    }).catch(function (e) {
      el.innerHTML = header(ctx) + '<p class="msg err">' + esc(e.message || "Could not load people.") + '</p>';
    });

    function namesOf(people) {
      var map = {}; people.forEach(function (p) { map[p.id] = p; });
      return map;
    }
    function summary(people, depts) {
      if (!cfg.required) return { cls: "", text: "A cash booking is confirmed straight away and the ticket is issued." };
      var deptName = {}; depts.forEach(function (d) { deptName[d.id] = d.name; });
      var who = [];
      cfg.people.forEach(function (id) { var p = people.filter(function (x) { return x.id === id; })[0]; who.push(p ? p.name : "Former member"); });
      cfg.designations.forEach(function (t) { who.push(t); });
      cfg.departments.forEach(function (id) { who.push(deptName[id] || "Department"); });
      if (!who.length) return { cls: " warn", text: "Approval is on, but nobody can approve a cash booking yet. Add a person, a designation or a department." };
      var how = cfg.mode === "all"
        ? "Every named person must approve, and one person from each selected designation and department."
        : "Any one of these can approve. One yes is enough.";
      return { cls: "", text: how + " " + who.join(", ") + "." };
    }
    function draw(people, depts, titles) {
      var P = namesOf(people);
      var deptList = depts.filter(function (d) { return d.active || cfg.departments.indexOf(d.id) >= 0; });
      var titleList = [];
      titles.forEach(function (t) { if (t.title && titleList.indexOf(t.title) < 0 && (t.active !== false || cfg.designations.indexOf(t.title) >= 0)) titleList.push(t.title); });
      cfg.designations.forEach(function (t) { if (titleList.indexOf(t) < 0) titleList.push(t); });
      var sum = summary(people, depts);
      var hits = q ? people.filter(function (p) {
        return cfg.people.indexOf(p.id) < 0 && (p.name + " " + p.role).toLowerCase().indexOf(q) >= 0;
      }).slice(0, 8) : [];
      el.innerHTML = header(ctx) + '<div class="caa">' +
        '<p class="caa-sum' + sum.cls + '">' + esc(sum.text) + '</p>' +
        '<section class="nr-card"><div class="nr-row" style="margin-top:0;border-top:0;padding-top:0"><span><strong>Cash bookings need approval</strong><small>Turn off to confirm a cash booking and issue the ticket immediately. Card and transfer payments are not held.</small></span>' +
          '<button type="button" class="sw" role="switch" id="caaReq" aria-checked="' + cfg.required + '" aria-label="Cash bookings need approval"' + (ctx.canEdit ? "" : " disabled") + '></button></div></section>' +
        (cfg.required ? '<section class="nr-card"><h3>Who can approve</h3><p class="note">Add one person, several people, designations, departments, or any mix of them.</p>' +
          '<div class="nr-lab">People</div>' +
          '<div class="caa-ppl">' + cfg.people.map(function (id) {
            var p = P[id];
            return '<span class="ap-person"><span class="ap-pn"><strong>' + esc(p ? p.name : "Former member") + '</strong><small>' + esc(p ? p.role : "No longer active") + '</small></span>' +
              (ctx.canEdit ? '<button type="button" class="ap-x" data-rm="' + esc(id) + '" aria-label="Remove">×</button>' : "") + '</span>';
          }).join("") + '</div>' +
          (ctx.canEdit ? '<div class="inv" style="margin-top:10px"><input id="caaQ" type="search" placeholder="Search staff by name" maxlength="80" value="' + esc(q) + '" aria-label="Search staff"></div>' +
            (hits.length ? '<ul class="caa-hits">' + hits.map(function (p) { return '<li><button type="button" data-add="' + esc(p.id) + '"><strong>' + esc(p.name) + '</strong><small>' + esc(p.role) + '</small></button></li>'; }).join("") + '</ul>' : (q ? '<p class="note">No matching staff.</p>' : "")) : "") +
          '<div class="nr-lab">Designations</div><div class="nr-chips">' + (titleList.length ? titleList.map(function (t) {
            var on = cfg.designations.indexOf(t) >= 0;
            return '<button type="button" class="nr-chip' + (on ? " on" : "") + '" data-title="' + esc(t) + '" aria-pressed="' + on + '"' + (ctx.canEdit ? "" : " disabled") + '>' + esc(t) + '</button>';
          }).join("") : '<small>No designations yet. Add them under HR → Departments &amp; Designations.</small>') + '</div>' +
          '<div class="nr-lab">Departments</div><div class="nr-chips">' + (deptList.length ? deptList.map(function (d) {
            var on = cfg.departments.indexOf(d.id) >= 0;
            return '<button type="button" class="nr-chip' + (on ? " on" : "") + '" data-dept="' + esc(d.id) + '" aria-pressed="' + on + '"' + (ctx.canEdit ? "" : " disabled") + '>' + esc(d.name) + '</button>';
          }).join("") : '<small>No departments yet. Add them under HR → Departments &amp; Designations.</small>') + '</div>' +
        '</section><section class="nr-card"><h3>How the approval works</h3><div class="nr-chips">' +
          '<button type="button" class="nr-chip' + (cfg.mode === "any" ? " on" : "") + '" data-mode="any" aria-pressed="' + (cfg.mode === "any") + '"' + (ctx.canEdit ? "" : " disabled") + '>Any one is enough</button>' +
          '<button type="button" class="nr-chip' + (cfg.mode === "all" ? " on" : "") + '" data-mode="all" aria-pressed="' + (cfg.mode === "all") + '"' + (ctx.canEdit ? "" : " disabled") + '>Everyone selected must approve</button>' +
        '</div><p class="note">' + (cfg.mode === "all"
          ? "Every named person has to say yes, and one person from each designation and each department has to say yes."
          : "One yes from a named person, or from anyone in a selected designation or department, is enough.") + '</p></section>' : "") +
        '</div>' + footer(ctx);
      var sw = document.getElementById("caaReq");
      if (sw && ctx.canEdit) sw.addEventListener("click", function () { cfg.required = !cfg.required; draw(people, depts, titles); });
      [].forEach.call(el.querySelectorAll("[data-rm]"), function (b) { b.addEventListener("click", function () { cfg.people = cfg.people.filter(function (id) { return id !== b.dataset.rm; }); draw(people, depts, titles); }); });
      [].forEach.call(el.querySelectorAll("[data-add]"), function (b) { b.addEventListener("click", function () { if (cfg.people.indexOf(b.dataset.add) < 0 && cfg.people.length < 40) cfg.people.push(b.dataset.add); q = ""; draw(people, depts, titles); }); });
      [].forEach.call(el.querySelectorAll("[data-title]"), function (b) { b.addEventListener("click", function () { var i = cfg.designations.indexOf(b.dataset.title); if (i >= 0) cfg.designations.splice(i, 1); else if (cfg.designations.length < 40) cfg.designations.push(b.dataset.title); draw(people, depts, titles); }); });
      [].forEach.call(el.querySelectorAll("[data-dept]"), function (b) { b.addEventListener("click", function () { var i = cfg.departments.indexOf(b.dataset.dept); if (i >= 0) cfg.departments.splice(i, 1); else if (cfg.departments.length < 40) cfg.departments.push(b.dataset.dept); draw(people, depts, titles); }); });
      [].forEach.call(el.querySelectorAll("[data-mode]"), function (b) { b.addEventListener("click", function () { cfg.mode = b.dataset.mode === "all" ? "all" : "any"; draw(people, depts, titles); }); });
      var box = document.getElementById("caaQ");
      if (box) {
        if (q) { box.focus(); var n = box.value.length; try { box.setSelectionRange(n, n); } catch (e2) {} }
        box.addEventListener("input", function () { q = box.value.trim().toLowerCase(); draw(people, depts, titles); });
      }
      bindSave(ctx, function () {
        if (cfg.required && !cfg.people.length && !cfg.designations.length && !cfg.departments.length) throw new Error("Choose who can approve, or turn approval off.");
        return { required: cfg.required, mode: cfg.mode, people: cfg.people.slice(), designations: cfg.designations.slice(), departments: cfg.departments.slice() };
      });
    }
  }

  function renderSmsContent(el, ctx) {
    var messages = (ctx.spec && ctx.spec.messages) || [];
    var saved = ctx.value && typeof ctx.value === "object" && !Array.isArray(ctx.value) ? ctx.value : {};
    var draft = {};
    messages.forEach(function (m) { draft[m.key] = typeof saved[m.key] === "string" && saved[m.key] ? saved[m.key] : m.text; });
    var companyName = (ctx.company && ctx.company.name) || "Your company";
    var tokens = ["{ref}", "{name}", "{route}", "{date}", "{time}", "{old_date}", "{company}", "{amount}", "{payment}", "{link}"];
    function fill(tpl, key) {
      var pay = key === "confirmed_prepaid" || key === "rescheduled" ? "Paid" : (key === "cancelled" ? "Refunded" : "Unpaid");
      var text = String(tpl || "");
      if (text.indexOf("{payment}") < 0) {
        text = text.indexOf("{link}") >= 0 ? text.replace("{link}", "Payment: {payment}.{link}") : text.replace(/\s*$/, "\nPayment: {payment}.");
      }
      var sample = {
        "{ref}": "BK-1042", "{name}": "Aisha Mohamed", "{route}": "Malé to Maafushi",
        "{date}": "6 November 2026", "{time}": "14:30", "{old_date}": "5 November 2026",
        "{company}": companyName, "{amount}": "450", "{payment}": pay,
        "{link}": "\nFollow this link to view your booking: https://tickets.example/BK-1042"
      };
      return tokens.reduce(function (s, k) { return s.split(k).join(sample[k]); }, text);
    }
    function parts(text) {
      var n = String(text || "").length;
      var unicode = /[^\u0000-\u007F]/.test(text || "");
      var one = unicode ? 70 : 160, more = unicode ? 67 : 153;
      var count = n === 0 ? 0 : (n <= one ? 1 : Math.ceil(n / more));
      return n + " characters · " + count + " text" + (count === 1 ? "" : "s") + (unicode ? " · accented letters" : "");
    }
    function warn(m, text) {
      if (m.key === "approved" && text.indexOf("{link}") < 0) return "This message has no ticket link.";
      if (m.key === "approval_sent" && text.indexOf("{link}") >= 0) return "This message includes a ticket link. Approval texts usually wait until the booking is approved.";
      return "";
    }
    function paintOne(key) {
      var box = document.getElementById("smsPrev-" + key);
      var meta = document.getElementById("smsMeta-" + key);
      var note = document.getElementById("smsWarn-" + key);
      var m = messages.filter(function (x) { return x.key === key; })[0];
      var text = draft[key] || "";
      if (box) box.textContent = fill(text, key) || "This message is empty.";
      if (meta) meta.textContent = parts(fill(text, key));
      if (note && m) { note.textContent = warn(m, text); note.hidden = !warn(m, text); }
    }
    el.innerHTML = header(ctx) + '<div class="sms-setup">' + messages.map(function (m) {
      return '<article class="sms-card"><div class="sms-edit"><h3>' + esc(m.title) + '</h3><p>' + esc(m.when) + '</p>' +
        '<div class="sms-tokens">' + tokens.map(function (t) { return '<button type="button" data-sms-token="' + esc(t) + '" data-sms-for="' + esc(m.key) + '">' + esc(t) + '</button>'; }).join("") + '</div>' +
        '<textarea id="smsBox-' + esc(m.key) + '" rows="8" maxlength="600" aria-label="' + esc(m.title) + '">' + esc(draft[m.key]) + '</textarea>' +
        '<div class="sms-row"><span id="smsMeta-' + esc(m.key) + '"></span><button type="button" class="sms-reset" data-sms-reset="' + esc(m.key) + '">Use standard text</button></div>' +
        '<p class="sms-warn" id="smsWarn-' + esc(m.key) + '" hidden></p></div>' +
        '<div class="sms-phone" aria-label="Preview"><small>Customer preview</small><div class="sms-bubble" id="smsPrev-' + esc(m.key) + '"></div></div></article>';
    }).join("") + '</div>' + footer(ctx);
    function fitBox(ta) {
      if (!ta) return;
      ta.style.height = "auto";
      ta.style.height = ta.scrollHeight + "px";
    }
    messages.forEach(function (m) { paintOne(m.key); });
    function fitAll() { [].forEach.call(el.querySelectorAll("textarea[id^='smsBox-']"), fitBox); }
    [].forEach.call(el.querySelectorAll("textarea[id^='smsBox-']"), function (ta) {
      var key = ta.id.slice(7);
      fitBox(ta);
      ta.addEventListener("input", function () { draft[key] = ta.value; paintOne(key); fitBox(ta); });
    });
    if (el._smsFit) window.removeEventListener("resize", el._smsFit);
    el._smsFit = fitAll;
    window.addEventListener("resize", el._smsFit);
    [].forEach.call(el.querySelectorAll("[data-sms-token]"), function (b) {
      b.addEventListener("click", function () {
        var ta = document.getElementById("smsBox-" + b.dataset.smsFor);
        if (!ta || ta.disabled) return;
        var s = ta.selectionStart, e = ta.selectionEnd, v = ta.value, token = b.dataset.smsToken;
        ta.value = v.slice(0, s) + token + v.slice(e);
        draft[b.dataset.smsFor] = ta.value;
        ta.focus();
        ta.selectionStart = ta.selectionEnd = s + token.length;
        paintOne(b.dataset.smsFor);
        fitBox(ta);
      });
    });
    [].forEach.call(el.querySelectorAll("[data-sms-reset]"), function (b) {
      b.addEventListener("click", function () {
        var m = messages.filter(function (x) { return x.key === b.dataset.smsReset; })[0];
        var ta = document.getElementById("smsBox-" + b.dataset.smsReset);
        if (!m || !ta || ta.disabled) return;
        ta.value = m.text;
        draft[m.key] = m.text;
        paintOne(m.key);
        fitBox(ta);
      });
    });
    bindSave(ctx, function () {
      var out = {};
      messages.forEach(function (m) {
        var v = String(draft[m.key] || "").replace(/\s+$/g, "");
        if (!v) throw new Error(m.title + " is empty.");
        if (v.length > 600) throw new Error(m.title + " is too long.");
        out[m.key] = v;
      });
      return out;
    });
    lock(el, ctx);
  }

  function render(el, ctx) {
    var type = ctx.spec && ctx.spec.type;
    // A redesigned editor (roster-settings-ui.js) takes over for a few settings; it reads and saves the same data.
    if (window.VEYORA_SETTING_VIEWS && window.VEYORA_SETTING_VIEWS[ctx.title] && ctx.spec && (type === "table" || type === "form")) { window.VEYORA_SETTING_VIEWS[ctx.title](el, ctx); return; }
    var map = { list: renderList, table: renderTable, form: renderForm, matrix: renderMatrix, company: renderCompany, status: renderStatus, info: renderInfo, audit: renderAudit, sessions: renderSessions, "export": renderExport, "import": renderImport, "arrival-approval": renderArrivalApproval, "sms-content": renderSmsContent };
    if (map[type]) map[type](el, ctx);
    else if (ctx.hooks && ctx.hooks[type]) ctx.hooks[type](el, ctx, header);
    else el.innerHTML = header(ctx) + '<div class="empty">This setting is not available yet.</div>';
    var b = el.querySelector("[data-back]"); if (b) b.addEventListener("click", ctx.onBack);
  }

  window.VeyoraEngine = { render: render, slug: slug, esc: esc, kit: { header: header, footer: footer, say: say, lock: lock, bindSave: bindSave, clone: clone } };
})();
