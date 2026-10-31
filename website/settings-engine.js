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
      '<p class="note">' + (st === "Active" ? "Your company is active." : st === "Pending" ? "Waiting for approval by the VEYORA platform owner." : "Your company is suspended. Contact the VEYORA platform owner.") + ' Only the platform owner can change company status.</p>';
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
    el.innerHTML = header(ctx) + '<p class="note">Restore settings from a VEYORA export file. Existing values for the same settings are replaced.</p>' +
      '<div class="inv"><input type="file" id="impFile" accept="application/json,.json"><button type="button" class="save" id="impGo">Import settings</button></div><p class="msg" id="itemMsg"></p>';
    lock(el, ctx);
    document.getElementById("impGo").addEventListener("click", function () {
      var f = document.getElementById("impFile").files[0]; if (!f) { say("Choose a file first.", "err"); return; }
      if (f.size > 1000000) { say("That file is too large.", "err"); return; }
      f.text().then(function (txt) {
        var obj = JSON.parse(txt), st = obj && (obj.settings || obj);
        if (!st || typeof st !== "object" || Array.isArray(st)) throw new Error("This is not a VEYORA export file.");
        var keys = Object.keys(st).filter(function (k) { return /^[a-z0-9_]{1,60}$/.test(k); });
        if (!keys.length) throw new Error("No settings found in that file.");
        if (keys.length > 400) throw new Error("Too many settings in that file.");
        say("Importing " + keys.length + " settings…");
        return keys.reduce(function (p, k) { return p.then(function () { return ctx.saveKey(k, st[k]); }); }, Promise.resolve()).then(function () { say("Imported " + keys.length + " settings.", "ok"); });
      }).catch(function (e) { say(e.message || "Could not import.", "err"); });
    });
  }

  function render(el, ctx) {
    var type = ctx.spec && ctx.spec.type;
    var map = { list: renderList, table: renderTable, form: renderForm, matrix: renderMatrix, company: renderCompany, status: renderStatus, info: renderInfo, audit: renderAudit, sessions: renderSessions, "export": renderExport, "import": renderImport };
    if (map[type]) map[type](el, ctx);
    else if (ctx.hooks && ctx.hooks[type]) ctx.hooks[type](el, ctx, header);
    else el.innerHTML = header(ctx) + '<div class="empty">This setting is not available yet.</div>';
    var b = el.querySelector("[data-back]"); if (b) b.addEventListener("click", ctx.onBack);
  }

  window.VeyoraEngine = { render: render, slug: slug, esc: esc };
})();
