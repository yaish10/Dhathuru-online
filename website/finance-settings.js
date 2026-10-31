/* Finance Settings UI — finance.html#settings[/section]
   Cursor 2026-10-24: sectioned nav (General, Categories, Payments, …) per recommended IA. */
(function () {
  var CUR_CODES = ["MVR", "USD", "EUR", "GBP", "LKR", "INR", "AED", "SGD"];
  var CUR_META = {
    MVR: { name: "Maldivian Rufiyaa", mark: "Rf" }, USD: { name: "US Dollar", mark: "$" },
    EUR: { name: "Euro", mark: "€" }, GBP: { name: "British Pound", mark: "£" },
    LKR: { name: "Sri Lankan Rupee", mark: "Rs" }, INR: { name: "Indian Rupee", mark: "₹" },
    AED: { name: "UAE Dirham", mark: "د.إ" }, SGD: { name: "Singapore Dollar", mark: "S$" }
  };
  var MONTHS = ["January", "April", "July", "October"];
  var DATE_FMTS = ["DD/MM/YYYY", "YYYY-MM-DD", "MM/DD/YYYY"];
  var DEF_METHODS = ["Cash", "Bank transfer", "Card", "Online gateway", "Mobile wallet", "Invoice"];

  var SECTIONS = [
    { id: "general", label: "General & Currency", hint: "Currency and financial year", phase: "essential" },
    { id: "categories", label: "Categories", hint: "Revenue and expenses", phase: "essential" },
    { id: "payments", label: "Payments & Accounts", hint: "Payment methods and bank accounts", phase: "essential" },
    { id: "invoices", label: "Invoices & Receipts", hint: "Numbering and document layouts", phase: "essential" },
    { id: "tax", label: "Tax", hint: "Tax rates and registration", phase: "essential" },
    { id: "approvals", label: "Approvals", hint: "Limits and approval rules", phase: "essential" },
    { id: "budgets", label: "Budgets & Periods", hint: "Budgets and period closing", phase: "next" },
    { id: "payroll", label: "Payroll Integration", hint: "Payroll posting and exports", phase: "later" },
    { id: "reports", label: "Reports", hint: "Reporting and reconciliation", phase: "next" }
  ];

  function esc(t) { return window.VeyoraShell.esc(t); }
  function strokeIcon(p) {
    return '<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="1.85" stroke-linecap="round" stroke-linejoin="round">' + p + '</svg>';
  }
  var IC = {
    cash: '<path d="M4 8h16v10H4zM4 11h16M9 15h2"/><path d="M8 8V6h8v2"/>',
    card: '<path d="M4 8h16v10H4zM4 11h16"/>',
    bank: '<path d="M3 10h18M5 10v8M19 10v8M3 18h18M12 4l9 6H3z"/>',
    list: '<path d="M8 6h13M8 12h13M8 18h13M3 6h.01M3 12h.01M3 18h.01"/>',
    file: '<path d="M7 3h7l5 5v13H7zM14 3v5h5"/>',
    percent: '<path d="M19 5 5 19M7.5 7.5a1.5 1.5 0 1 0 0-3 1.5 1.5 0 0 0 0 3ZM16.5 19.5a1.5 1.5 0 1 0 0-3 1.5 1.5 0 0 0 0 3Z"/>',
    shield: '<path d="M12 3 4 6v6c0 4.5 3.3 7.8 8 9 4.7-1.2 8-4.5 8-9V6l-8-3Z"/>',
    calendar: '<path d="M4 6h16v14H4zM4 10h16M9 3v4M15 3v4"/>',
    people: '<path d="M12 12a4 4 0 1 0 0-8 4 4 0 0 0 0 8ZM4 21c0-4 4-6 8-6s8 2 8 6"/>',
    chart: '<path d="M4 19V5M4 19h16M8 16v-5M12 16V8M16 16v-3"/>',
    plus: '<path d="M12 5v14M5 12h14"/>',
    check: '<path d="m5 12 5 5 9-10"/>',
    spark: '<path d="M12 3v4M12 17v4M3 12h4M17 12h4"/>'
  };

  function curMeta(code) { return CUR_META[code] || { name: code, mark: code.slice(0, 2) }; }

  function api(ctx) { return ctx; }

  function setting(ctx, key) { return ctx.company && ctx.company.settings ? ctx.company.settings[key] : undefined; }
  function formOf(ctx, key, title) {
    var saved = setting(ctx, key), spec = window.VEYORA_DEFS && window.VEYORA_DEFS[title], out = {};
    (spec && spec.fields || []).forEach(function (f) { out[f.k] = f.d; });
    if (saved && typeof saved === "object" && !Array.isArray(saved)) Object.keys(saved).forEach(function (k) { out[k] = saved[k]; });
    return out;
  }
  function rowsOf(ctx, key, title) {
    var saved = setting(ctx, key), spec = (window.VEYORA_DEFS && window.VEYORA_DEFS[title]) || {};
    var rows = Array.isArray(saved) ? saved : (spec.def || []);
    return rows.map(function (r) {
      if (typeof r === "string") return { name: r, active: true };
      return Object.assign({ active: true }, r);
    }).filter(function (r) { return r && r.name; });
  }
  function namesOf(ctx, key, title, fallback) {
    var rows = rowsOf(ctx, key, title);
    var names = rows.filter(function (r) { return r.active !== false; }).map(function (r) { return r.name; });
    if (!names.length && fallback) return fallback.slice();
    return names.length ? names : (fallback || []);
  }
  function save(ctx, key, val) {
    return ctx.db.rpc("set_company_setting", { p_company: ctx.company.id, p_key: key, p_value: val }).then(function (r) {
      if (r.error) throw new Error(r.error.message);
      ctx.company.settings = ctx.company.settings || {};
      ctx.company.settings[key] = val;
    });
  }

  function phaseTag(phase) {
    if (phase === "essential") return '<span class="fs-phase live">Essential</span>';
    if (phase === "next") return '<span class="fs-phase next">Next phase</span>';
    return '<span class="fs-phase later">Later</span>';
  }

  function navHtml(section) {
    return '<nav class="fs-nav" aria-label="Finance settings">' +
      SECTIONS.map(function (s) {
        return '<a class="fs-nav-item' + (s.id === section ? " on" : "") + '" href="#settings/' + s.id + '">' +
          '<strong>' + esc(s.label) + '</strong><small>' + esc(s.hint) + '</small>' + phaseTag(s.phase) +
        '</a>';
      }).join("") +
    '</nav>';
  }

  function shell(section, body) {
    var s = SECTIONS.filter(function (x) { return x.id === section; })[0] || SECTIONS[0];
    return '<div class="fs-layout">' +
      navHtml(s.id) +
      '<div class="fs-main">' +
        '<header class="fs-main-h">' +
          '<div><p class="fs-kicker">Finance settings</p><h2>' + esc(s.label) + '</h2><p class="fs-sub">' + esc(s.hint) + '</p></div>' +
          phaseTag(s.phase) +
        '</header>' +
        body +
      '</div></div>';
  }

  function card(title, note, inner, acts) {
    return '<section class="fs-card">' +
      '<div class="fs-card-h"><div><h3>' + title + '</h3>' + (note ? '<p>' + note + '</p>' : "") + '</div>' + (acts || "") + '</div>' +
      inner +
    '</section>';
  }

  function soon(items) {
    return '<ul class="fs-soon">' + items.map(function (t) { return '<li>' + esc(t) + '</li>'; }).join("") + '</ul>';
  }

  function toast(ctx, msg, ok) {
    var el = document.getElementById("fsToast");
    if (!el) return;
    el.textContent = msg;
    el.className = "fs-toast" + (ok ? " ok" : " err");
    el.hidden = false;
    clearTimeout(toast._t);
    toast._t = setTimeout(function () { el.hidden = true; }, 2800);
  }

  function bindSave(ctx, btnId, collect) {
    var btn = document.getElementById(btnId);
    if (!btn) return;
    btn.addEventListener("click", function () {
      btn.disabled = true;
      Promise.resolve(collect()).then(function () {
        toast(ctx, "Saved.", true);
        ctx.rerender();
      }).catch(function (e) {
        toast(ctx, e.message || "Could not save.", false);
        btn.disabled = false;
      });
    });
  }

  /* —— Section: General & Currency —— */
  function renderGeneral(ctx) {
    var base = formOf(ctx, "9_base_currency", "Base Currency");
    var code = base.base || (ctx.company && ctx.company.currency) || "MVR";
    var dec = Number(base.decimals) >= 0 ? Number(base.decimals) : 2;
    var periods = formOf(ctx, "9_financial_periods", "Financial Periods");
    var supported = namesOf(ctx, "9_supported_currencies", "Supported Currencies", [code]);
    if (supported.indexOf(code) < 0) supported = [code].concat(supported);

    var body =
      card("Default currency", "Used for Finance totals and Operations payment amounts.",
        '<div class="fs-fields cols-2">' +
          '<div class="fld"><label for="fsBase">Default currency</label><select id="fsBase">' +
            CUR_CODES.map(function (c) { return '<option value="' + c + '"' + (c === code ? " selected" : "") + '>' + c + " — " + curMeta(c).name + '</option>'; }).join("") +
          '</select></div>' +
          '<div class="fld"><label for="fsDec">Currency decimal places</label><input id="fsDec" type="number" min="0" max="4" value="' + dec + '"></div>' +
        '</div>',
        '<button type="button" class="primary-btn" id="fsSaveBase">Save currency</button>') +
      card("Supported currencies", "Currencies your company accepts. Base currency stays on the list.",
        '<div class="fs-chips" id="fsSupChips">' +
          supported.map(function (c) {
            var lock = c === code;
            return '<span class="fs-chip' + (lock ? " base" : "") + '" data-cur="' + esc(c) + '">' +
              '<b>' + esc(curMeta(c).mark) + '</b> ' + esc(c) +
              (lock ? '<em>Base</em>' : (ctx.canEdit ? '<button type="button" data-rm-cur="' + esc(c) + '" aria-label="Remove">×</button>' : "")) +
            '</span>';
          }).join("") +
        '</div>' +
        (ctx.canEdit
          ? '<div class="fs-add-row"><select id="fsAddCur">' +
              CUR_CODES.filter(function (c) { return supported.indexOf(c) < 0; }).map(function (c) { return '<option value="' + c + '">' + c + '</option>'; }).join("") +
            '</select><button type="button" class="btn-soft" id="fsAddCurBtn">' + strokeIcon(IC.plus) + ' Add</button></div>'
          : ""),
        ctx.canEdit ? '<button type="button" class="primary-btn" id="fsSaveSup">Save list</button>' : "") +
      card("Financial year &amp; dates", "Controls fiscal start and how finance dates are shown.",
        '<div class="fs-fields cols-2">' +
          '<div class="fld"><label for="fsFy">Financial year start</label><select id="fsFy">' +
            MONTHS.map(function (m) { return '<option' + (m === (periods.start || "January") ? " selected" : "") + '>' + m + '</option>'; }).join("") +
          '</select></div>' +
          '<div class="fld"><label for="fsDateFmt">Date format for financial records</label><select id="fsDateFmt">' +
            DATE_FMTS.map(function (f) { return '<option' + (f === (periods.dateFormat || "DD/MM/YYYY") ? " selected" : "") + '>' + f + '</option>'; }).join("") +
          '</select></div>' +
        '</div>',
        ctx.canEdit ? '<button type="button" class="primary-btn" id="fsSavePeriod">Save</button>' : "");

    setTimeout(function () {
      if (!ctx.canEdit) return;
      var list = supported.slice();
      var chips = document.getElementById("fsSupChips");
      if (chips) chips.addEventListener("click", function (e) {
        var btn = e.target.closest("[data-rm-cur]");
        if (!btn) return;
        var c = btn.getAttribute("data-rm-cur");
        if (c === code) return;
        list = list.filter(function (x) { return x !== c; });
        ctx.company.settings = ctx.company.settings || {};
        ctx.company.settings["9_supported_currencies"] = list;
        ctx.rerender();
      });
      var addBtn = document.getElementById("fsAddCurBtn");
      if (addBtn) addBtn.addEventListener("click", function () {
        var c = (document.getElementById("fsAddCur") || {}).value;
        if (!c || list.indexOf(c) >= 0) return;
        list.push(c);
        ctx.company.settings = ctx.company.settings || {};
        ctx.company.settings["9_supported_currencies"] = list;
        ctx.rerender();
      });
      bindSave(ctx, "fsSaveBase", function () {
        var b = document.getElementById("fsBase").value;
        var d = Math.min(4, Math.max(0, Number(document.getElementById("fsDec").value) || 0));
        return save(ctx, "9_base_currency", { base: b, decimals: d }).then(function () {
          var cur = namesOf(ctx, "9_supported_currencies", "Supported Currencies", [b]);
          if (cur.indexOf(b) < 0) return save(ctx, "9_supported_currencies", [b].concat(cur));
        });
      });
      bindSave(ctx, "fsSaveSup", function () {
        var cur = namesOf(ctx, "9_supported_currencies", "Supported Currencies", [code]);
        if (cur.indexOf(code) < 0) cur.unshift(code);
        return save(ctx, "9_supported_currencies", cur);
      });
      bindSave(ctx, "fsSavePeriod", function () {
        var next = Object.assign({}, periods, {
          start: document.getElementById("fsFy").value,
          dateFormat: document.getElementById("fsDateFmt").value
        });
        return save(ctx, "9_financial_periods", next);
      });
    }, 0);

    return body;
  }

  /* —— Categories —— */
  function catEditor(ctx, key, title, addId, saveId) {
    var rows = rowsOf(ctx, key, title);
    return '<div class="fs-rows" data-cat-key="' + key + '">' +
      rows.map(function (r, i) {
        return '<div class="fs-row" data-i="' + i + '">' +
          '<input class="fs-row-name" value="' + esc(r.name) + '"' + (ctx.canEdit ? "" : " readonly") + '>' +
          '<label class="fs-toggle"><input type="checkbox" class="fs-row-active"' + (r.active !== false ? " checked" : "") + (ctx.canEdit ? "" : " disabled") + '> Active</label>' +
          (ctx.canEdit ? '<button type="button" class="fs-icon-btn" data-rm="' + i + '" title="Remove">×</button>' : "") +
        '</div>';
      }).join("") +
    '</div>' +
    (ctx.canEdit
      ? '<div class="fs-add-row"><input id="' + addId + '" maxlength="60" placeholder="New category"><button type="button" class="btn-soft" data-add-cat="' + key + '">' + strokeIcon(IC.plus) + ' Add</button></div>' +
        '<p class="fs-card-foot"><button type="button" class="primary-btn" id="' + saveId + '">Save categories</button></p>'
      : "");
  }

  function collectCatRows(wrap) {
    return [].map.call(wrap.querySelectorAll(".fs-row"), function (row) {
      var name = (row.querySelector(".fs-row-name").value || "").trim();
      var active = row.querySelector(".fs-row-active").checked;
      return name ? { name: name, active: active } : null;
    }).filter(Boolean);
  }

  function renderCategories(ctx) {
    var defs = formOf(ctx, "9_category_defaults", "Category Defaults");
    var revNames = namesOf(ctx, "9_revenue_categories", "Revenue Categories", ["Ticket sales"]);
    var expNames = namesOf(ctx, "9_expense_categories", "Expense Categories", ["Fuel"]);

    var body =
      card("Revenue categories", "Ticket sales, charter, and other income labels.",
        catEditor(ctx, "9_revenue_categories", "Revenue Categories", "fsAddRev", "fsSaveRev")) +
      card("Expense categories", "Fuel, repairs, salaries, utilities, supplies, and custom spend labels.",
        catEditor(ctx, "9_expense_categories", "Expense Categories", "fsAddExp", "fsSaveExp")) +
      card("Defaults for imported transactions", "Used when a category is missing on import or auto-post.",
        '<div class="fs-fields cols-2">' +
          '<div class="fld"><label for="fsDefRev">Default revenue category</label><select id="fsDefRev">' +
            revNames.map(function (n) { return '<option' + (n === (defs.revenueImport || revNames[0]) ? " selected" : "") + '>' + esc(n) + '</option>'; }).join("") +
          '</select></div>' +
          '<div class="fld"><label for="fsDefExp">Default expense category</label><select id="fsDefExp">' +
            expNames.map(function (n) { return '<option' + (n === (defs.expenseImport || expNames[0]) ? " selected" : "") + '>' + esc(n) + '</option>'; }).join("") +
          '</select></div>' +
        '</div>',
        ctx.canEdit ? '<button type="button" class="primary-btn" id="fsSaveCatDef">Save defaults</button>' : "");

    setTimeout(function () {
      if (!ctx.canEdit) return;
      document.querySelectorAll("[data-add-cat]").forEach(function (btn) {
        btn.addEventListener("click", function () {
          var key = btn.getAttribute("data-add-cat");
          var input = document.getElementById(key.indexOf("revenue") > -1 ? "fsAddRev" : "fsAddExp");
          var name = (input && input.value || "").trim();
          if (!name) return;
          var rows = rowsOf(ctx, key, key.indexOf("revenue") > -1 ? "Revenue Categories" : "Expense Categories");
          if (rows.some(function (r) { return r.name.toLowerCase() === name.toLowerCase(); })) { toast(ctx, "Already on the list.", false); return; }
          rows.push({ name: name, active: true });
          ctx.company.settings[key] = rows;
          ctx.rerender();
        });
      });
      document.querySelectorAll(".fs-rows").forEach(function (wrap) {
        wrap.addEventListener("click", function (e) {
          var btn = e.target.closest("[data-rm]");
          if (!btn) return;
          var key = wrap.getAttribute("data-cat-key");
          var rows = collectCatRows(wrap);
          rows.splice(Number(btn.getAttribute("data-rm")), 1);
          ctx.company.settings[key] = rows;
          ctx.rerender();
        });
      });
      bindSave(ctx, "fsSaveRev", function () {
        return save(ctx, "9_revenue_categories", collectCatRows(document.querySelector('[data-cat-key="9_revenue_categories"]')));
      });
      bindSave(ctx, "fsSaveExp", function () {
        return save(ctx, "9_expense_categories", collectCatRows(document.querySelector('[data-cat-key="9_expense_categories"]')));
      });
      bindSave(ctx, "fsSaveCatDef", function () {
        return save(ctx, "9_category_defaults", {
          revenueImport: document.getElementById("fsDefRev").value,
          expenseImport: document.getElementById("fsDefExp").value
        });
      });
    }, 0);

    return body;
  }

  /* —— Payments & Accounts —— */
  function renderPayments(ctx) {
    var methods = namesOf(ctx, "9_payment_methods", "Payment Methods", DEF_METHODS);
    var accounts = rowsOf(ctx, "9_finance_accounts", "Finance Accounts");
    var recon = formOf(ctx, "9_reconciliation_settings", "Reconciliation Settings");
    var base = formOf(ctx, "9_base_currency", "Base Currency").base || "MVR";

    var body =
      card("Payment methods", "Operations Mark paid and New booking only offer methods listed here.",
        '<div class="fs-method-grid" id="fsMethods">' +
          methods.map(function (m, i) {
            return '<div class="fs-method" data-i="' + i + '"><strong>' + esc(m) + '</strong>' +
              (ctx.canEdit ? '<button type="button" data-rm-m="' + i + '">Remove</button>' : "") + '</div>';
          }).join("") +
        '</div>' +
        (ctx.canEdit
          ? '<div class="fs-add-row"><input id="fsAddMeth" maxlength="40" placeholder="e.g. QR pay"><button type="button" class="btn-soft" id="fsAddMethBtn">' + strokeIcon(IC.plus) + ' Add</button></div>' +
            '<p class="fs-card-foot"><button type="button" class="primary-btn" id="fsSaveMeth">Save methods</button></p>'
          : "")) +
      card("Bank and cash accounts", "Accounts used when reconciling payments.",
        '<div class="fs-rows" id="fsAccounts">' +
          accounts.map(function (a, i) {
            return '<div class="fs-row acct" data-i="' + i + '">' +
              '<input class="fs-acc-name" value="' + esc(a.name || "") + '"' + (ctx.canEdit ? "" : " readonly") + '>' +
              '<select class="fs-acc-type"' + (ctx.canEdit ? "" : " disabled") + '><option' + (a.type === "Bank" ? " selected" : "") + '>Bank</option><option' + (a.type !== "Bank" ? " selected" : "") + '>Cash</option></select>' +
              '<input class="fs-acc-cur" value="' + esc(a.currency || base) + '" maxlength="3"' + (ctx.canEdit ? "" : " readonly") + '>' +
              '<label class="fs-toggle"><input type="checkbox" class="fs-acc-active"' + (a.active !== false ? " checked" : "") + (ctx.canEdit ? "" : " disabled") + '> Active</label>' +
              (ctx.canEdit ? '<button type="button" class="fs-icon-btn" data-rm-a="' + i + '">×</button>' : "") +
            '</div>';
          }).join("") +
        '</div>' +
        (ctx.canEdit
          ? '<div class="fs-add-row"><button type="button" class="btn-soft" id="fsAddAcc">' + strokeIcon(IC.plus) + ' Add account</button></div>' +
            '<p class="fs-card-foot"><button type="button" class="primary-btn" id="fsSaveAcc">Save accounts</button></p>'
          : "")) +
      card("Transaction reconciliation", "Matching paid bookings and invoices to cash and bank records.",
        '<div class="fs-fields">' +
          '<label class="fs-toggle block"><input type="checkbox" id="fsReqAcc"' + (recon.requireAccount ? " checked" : "") + (ctx.canEdit ? "" : " disabled") + '> Require an account on paid bookings</label>' +
          '<label class="fs-toggle block"><input type="checkbox" id="fsWarnUn"' + (recon.warnUnmatched !== false ? " checked" : "") + (ctx.canEdit ? "" : " disabled") + '> Warn on unmatched payments</label>' +
          '<div class="fld" style="max-width:200px"><label for="fsMatchDays">Auto-match window (days)</label><input id="fsMatchDays" type="number" min="0" max="30" value="' + (Number(recon.matchDays) >= 0 ? Number(recon.matchDays) : 3) + '"' + (ctx.canEdit ? "" : " readonly") + '></div>' +
        '</div>',
        ctx.canEdit ? '<button type="button" class="primary-btn" id="fsSaveRecon">Save</button>' : "");

    setTimeout(function () {
      if (!ctx.canEdit) return;
      var meths = methods.slice();
      document.getElementById("fsMethods").addEventListener("click", function (e) {
        var btn = e.target.closest("[data-rm-m]");
        if (!btn) return;
        meths.splice(Number(btn.getAttribute("data-rm-m")), 1);
        ctx.company.settings["9_payment_methods"] = meths;
        ctx.rerender();
      });
      document.getElementById("fsAddMethBtn").addEventListener("click", function () {
        var v = (document.getElementById("fsAddMeth").value || "").trim();
        if (!v) return;
        if (meths.indexOf(v) >= 0) { toast(ctx, "Already listed.", false); return; }
        meths.push(v);
        ctx.company.settings["9_payment_methods"] = meths;
        ctx.rerender();
      });
      bindSave(ctx, "fsSaveMeth", function () {
        var list = namesOf(ctx, "9_payment_methods", "Payment Methods", DEF_METHODS);
        if (!list.length) throw new Error("Add at least one payment method.");
        return save(ctx, "9_payment_methods", list);
      });

      document.getElementById("fsAddAcc").addEventListener("click", function () {
        var rows = rowsOf(ctx, "9_finance_accounts", "Finance Accounts");
        rows.push({ name: "New account", type: "Bank", currency: base, active: true });
        ctx.company.settings["9_finance_accounts"] = rows;
        ctx.rerender();
      });
      document.getElementById("fsAccounts").addEventListener("click", function (e) {
        var btn = e.target.closest("[data-rm-a]");
        if (!btn) return;
        var rows = rowsOf(ctx, "9_finance_accounts", "Finance Accounts");
        rows.splice(Number(btn.getAttribute("data-rm-a")), 1);
        ctx.company.settings["9_finance_accounts"] = rows;
        ctx.rerender();
      });
      bindSave(ctx, "fsSaveAcc", function () {
        var rows = [].map.call(document.querySelectorAll("#fsAccounts .fs-row"), function (row) {
          var name = (row.querySelector(".fs-acc-name").value || "").trim();
          if (!name) return null;
          return {
            name: name,
            type: row.querySelector(".fs-acc-type").value,
            currency: (row.querySelector(".fs-acc-cur").value || base).toUpperCase(),
            active: row.querySelector(".fs-acc-active").checked
          };
        }).filter(Boolean);
        return save(ctx, "9_finance_accounts", rows);
      });
      bindSave(ctx, "fsSaveRecon", function () {
        return save(ctx, "9_reconciliation_settings", {
          requireAccount: document.getElementById("fsReqAcc").checked,
          warnUnmatched: document.getElementById("fsWarnUn").checked,
          matchDays: Math.max(0, Number(document.getElementById("fsMatchDays").value) || 0)
        });
      });
    }, 0);

    return body;
  }

  /* —— Invoices & Receipts —— */
  function fmtFields(prefix, f) {
    f = f || {};
    return '<div class="fs-fields cols-3">' +
      '<div class="fld"><label>Prefix</label><input class="fs-fmt-prefix" data-fmt="' + prefix + '" value="' + esc(f.prefix || prefix) + '" maxlength="12"></div>' +
      '<div class="fld"><label>Separator</label><select class="fs-fmt-sep" data-fmt="' + prefix + '"><option value="-"' + ((f.sep || "-") === "-" ? " selected" : "") + '>-</option><option value="/"' + (f.sep === "/" ? " selected" : "") + '>/</option><option value="none"' + (f.sep === "none" ? " selected" : "") + '>none</option></select></div>' +
      '<div class="fld"><label>Digits</label><input class="fs-fmt-digits" data-fmt="' + prefix + '" type="number" min="3" max="10" value="' + (Number(f.digits) || 6) + '"></div>' +
      '<label class="fs-toggle block"><input type="checkbox" class="fs-fmt-year" data-fmt="' + prefix + '"' + (f.year !== false ? " checked" : "") + '> Include year</label>' +
      '<div class="fld"><label>Next number</label><input class="fs-fmt-start" data-fmt="' + prefix + '" type="number" min="1" value="' + (Number(f.start) || 1) + '"></div>' +
    '</div>';
  }
  function readFmt(prefix) {
    var root = document.querySelector('.fs-fmt-prefix[data-fmt="' + prefix + '"]');
    if (!root) return null;
    var g = function (sel) { return document.querySelector(sel + '[data-fmt="' + prefix + '"]'); };
    return {
      prefix: (g(".fs-fmt-prefix").value || prefix).trim(),
      sep: g(".fs-fmt-sep").value,
      digits: Math.max(3, Number(g(".fs-fmt-digits").value) || 6),
      year: g(".fs-fmt-year").checked,
      start: Math.max(1, Number(g(".fs-fmt-start").value) || 1)
    };
  }

  function renderInvoices(ctx) {
    var inv = formOf(ctx, "9_invoice_number_format", "Invoice Number Format");
    var rct = formOf(ctx, "9_receipt_number_format", "Receipt Number Format");
    var brand = formOf(ctx, "9_document_branding", "Document Branding");
    var terms = formOf(ctx, "9_payment_terms", "Payment Terms");

    var body =
      card("Invoice number format", "Pattern for outstanding invoice numbers.", fmtFields("INV", inv)) +
      card("Receipt number format", "Pattern for payment receipts.", fmtFields("RCT", rct)) +
      card("Company details on documents", "What appears on invoice and receipt PDFs.",
        '<div class="fs-fields">' +
          '<label class="fs-toggle block"><input type="checkbox" id="fsShowLogo"' + (brand.showLogo !== false ? " checked" : "") + '> Show company logo</label>' +
          '<label class="fs-toggle block"><input type="checkbox" id="fsShowAddr"' + (brand.showAddress !== false ? " checked" : "") + '> Show office address</label>' +
          '<label class="fs-toggle block"><input type="checkbox" id="fsShowReg"' + (brand.showReg !== false ? " checked" : "") + '> Show registration number</label>' +
          '<div class="fld"><label for="fsFooter">Default document footer</label><textarea id="fsFooter" rows="2">' + esc(brand.footer || "") + '</textarea></div>' +
        '</div>') +
      card("Payment terms &amp; notes", "Defaults applied to new invoices.",
        '<div class="fs-fields cols-2">' +
          '<div class="fld"><label for="fsTermsDays">Payment due in (days)</label><input id="fsTermsDays" type="number" min="0" max="365" value="' + (Number(terms.days) >= 0 ? Number(terms.days) : 14) + '"></div>' +
          '<div class="fld"><label for="fsTermsNote">Default invoice notes</label><textarea id="fsTermsNote" rows="3">' + esc(terms.note || "") + '</textarea></div>' +
        '</div>') +
      '<p class="fs-card-foot">' + (ctx.canEdit ? '<button type="button" class="primary-btn" id="fsSaveInv">Save invoice &amp; receipt settings</button>' : "") + '</p>' +
      card("PDF layouts", "Design invoices and receipts with a shared layout maker. Company name, logo and address always load from your company profile.",
        '<p class="fs-note">Preview and downloaded PDF use the same HTML engine — not a screenshot of the editor.</p>' +
        '<p class="fs-card-foot"><a class="primary-btn" href="pdf-layouts.html" style="display:inline-flex;text-decoration:none">' + strokeIcon(IC.file) + ' Open PDF Layouts</a></p>');

    setTimeout(function () {
      if (!ctx.canEdit) return;
      [].forEach.call(document.querySelectorAll(".fs-fmt-prefix, .fs-fmt-sep, .fs-fmt-digits, .fs-fmt-year, .fs-fmt-start, #fsShowLogo, #fsShowAddr, #fsShowReg, #fsFooter, #fsTermsDays, #fsTermsNote"), function (el) {
        if (!ctx.canEdit) el.setAttribute("disabled", "disabled");
      });
      bindSave(ctx, "fsSaveInv", function () {
        return Promise.all([
          save(ctx, "9_invoice_number_format", readFmt("INV")),
          save(ctx, "9_receipt_number_format", readFmt("RCT")),
          save(ctx, "9_document_branding", {
            showLogo: document.getElementById("fsShowLogo").checked,
            showAddress: document.getElementById("fsShowAddr").checked,
            showReg: document.getElementById("fsShowReg").checked,
            footer: document.getElementById("fsFooter").value
          }),
          save(ctx, "9_payment_terms", {
            days: Math.max(0, Number(document.getElementById("fsTermsDays").value) || 0),
            note: document.getElementById("fsTermsNote").value
          })
        ]);
      });
    }, 0);

    return body;
  }

  /* —— Tax —— */
  function renderTax(ctx) {
    var tax = formOf(ctx, "9_tax_configuration", "Tax Configuration");
    var rates = rowsOf(ctx, "9_tax_rates", "Tax Rates");
    if (!rates.length && tax.name) rates = [{ name: tax.name, rate: tax.rate, active: true }];

    var body =
      card("Tax registration", "Company tax identity and whether prices include tax.",
        '<div class="fs-fields cols-2">' +
          '<div class="fld"><label for="fsTaxId">Tax registration details</label><input id="fsTaxId" value="' + esc(tax.taxId || "") + '" placeholder="TIN / GST number"></div>' +
          '<label class="fs-toggle block" style="align-self:end"><input type="checkbox" id="fsTaxInc"' + (tax.inclusive !== false ? " checked" : "") + '> Tax-inclusive prices</label>' +
        '</div>') +
      card("Tax types and rates", "Configurable rates — not hard-coded. Used on invoices and receipts.",
        '<div class="fs-rows" id="fsTaxRates">' +
          rates.map(function (r, i) {
            return '<div class="fs-row tax" data-i="' + i + '">' +
              '<input class="fs-tax-name" value="' + esc(r.name || "") + '" placeholder="Tax type">' +
              '<input class="fs-tax-rate" type="number" min="0" max="100" step="0.01" value="' + (Number(r.rate) || 0) + '">' +
              '<span class="fs-unit">%</span>' +
              '<label class="fs-toggle"><input type="checkbox" class="fs-tax-active"' + (r.active !== false ? " checked" : "") + '> Active</label>' +
              (ctx.canEdit ? '<button type="button" class="fs-icon-btn" data-rm-t="' + i + '">×</button>' : "") +
            '</div>';
          }).join("") +
        '</div>' +
        (ctx.canEdit
          ? '<div class="fs-add-row"><button type="button" class="btn-soft" id="fsAddTax">' + strokeIcon(IC.plus) + ' Add tax type</button></div>'
          : "")) +
      card("Tax exemptions &amp; reporting", "Advanced tax rules.", soon(["Customer / route tax exemptions", "Tax reporting periods", "Filing export packs"])) +
      (ctx.canEdit ? '<p class="fs-card-foot"><button type="button" class="primary-btn" id="fsSaveTax">Save tax settings</button></p>' : "");

    setTimeout(function () {
      if (!ctx.canEdit) return;
      document.getElementById("fsAddTax").addEventListener("click", function () {
        var rows = rowsOf(ctx, "9_tax_rates", "Tax Rates");
        if (!rows.length && tax.name) rows = [{ name: tax.name, rate: tax.rate, active: true }];
        rows.push({ name: "New tax", rate: 0, active: true });
        ctx.company.settings["9_tax_rates"] = rows;
        ctx.rerender();
      });
      document.getElementById("fsTaxRates").addEventListener("click", function (e) {
        var btn = e.target.closest("[data-rm-t]");
        if (!btn) return;
        var rows = [].map.call(document.querySelectorAll("#fsTaxRates .fs-row"), function (row) {
          return { name: row.querySelector(".fs-tax-name").value, rate: Number(row.querySelector(".fs-tax-rate").value) || 0, active: row.querySelector(".fs-tax-active").checked };
        });
        rows.splice(Number(btn.getAttribute("data-rm-t")), 1);
        ctx.company.settings["9_tax_rates"] = rows;
        ctx.rerender();
      });
      bindSave(ctx, "fsSaveTax", function () {
        var ratesNow = [].map.call(document.querySelectorAll("#fsTaxRates .fs-row"), function (row) {
          var name = (row.querySelector(".fs-tax-name").value || "").trim();
          if (!name) return null;
          return { name: name, rate: Number(row.querySelector(".fs-tax-rate").value) || 0, active: row.querySelector(".fs-tax-active").checked };
        }).filter(Boolean);
        var primary = ratesNow.filter(function (r) { return r.active; })[0] || ratesNow[0] || { name: "GST", rate: 0 };
        return Promise.all([
          save(ctx, "9_tax_rates", ratesNow),
          save(ctx, "9_tax_configuration", {
            inclusive: document.getElementById("fsTaxInc").checked,
            taxId: document.getElementById("fsTaxId").value,
            name: primary.name,
            rate: primary.rate
          })
        ]);
      });
    }, 0);

    return body;
  }

  /* —— Approvals —— */
  function renderApprovals(ctx) {
    var lim = formOf(ctx, "9_financial_approval_limits", "Financial Approval Limits");
    var body =
      card("Approval limits", "Amounts in base currency. Above the limit escalates.",
        '<div class="fs-fields cols-2">' +
          '<div class="fld"><label for="fsLimExp">Expense approval limit</label><input id="fsLimExp" type="number" min="0" value="' + (Number(lim.expense) >= 0 ? lim.expense : (lim.operations || 5000)) + '"></div>' +
          '<div class="fld"><label for="fsLimPay">Payment approval limit</label><input id="fsLimPay" type="number" min="0" value="' + (Number(lim.payment) >= 0 ? lim.payment : 20000) + '"></div>' +
          '<div class="fld"><label for="fsLimPur">Purchase approval threshold</label><input id="fsLimPur" type="number" min="0" value="' + (Number(lim.purchase) >= 0 ? lim.purchase : 10000) + '"></div>' +
          '<div class="fld"><label for="fsLimRef">Refund approval threshold</label><input id="fsLimRef" type="number" min="0" value="' + (Number(lim.refund) >= 0 ? lim.refund : 2000) + '"></div>' +
          '<div class="fld"><label for="fsLimAbove">Above limits escalate to</label><select id="fsLimAbove"><option' + ((lim.above || "Owner").indexOf("Owner") === 0 ? " selected" : "") + '>Owner</option><option' + (/Admin/i.test(lim.above || "") ? " selected" : "") + '>Admin</option></select></div>' +
          '<label class="fs-toggle block" style="align-self:end"><input type="checkbox" id="fsLimSep"' + (lim.separate !== false ? " checked" : "") + '> Separation of requester and approver</label>' +
        '</div>',
        ctx.canEdit ? '<button type="button" class="primary-btn" id="fsSaveLim">Save approval rules</button>' : "") +
      card("Approval levels &amp; escalation", "Multi-step workflows.", soon(["Multi-level approval chains", "Escalation reminders / SLA", "Role matrix per request type"]));

    setTimeout(function () {
      if (!ctx.canEdit) return;
      bindSave(ctx, "fsSaveLim", function () {
        return save(ctx, "9_financial_approval_limits", Object.assign({}, lim, {
          expense: Number(document.getElementById("fsLimExp").value) || 0,
          payment: Number(document.getElementById("fsLimPay").value) || 0,
          purchase: Number(document.getElementById("fsLimPur").value) || 0,
          refund: Number(document.getElementById("fsLimRef").value) || 0,
          above: document.getElementById("fsLimAbove").value === "Admin" ? "Admin approves" : "Owner approves",
          separate: document.getElementById("fsLimSep").checked
        }));
      });
    }, 0);

    return body;
  }

  function renderBudgets(ctx) {
    var periods = formOf(ctx, "9_financial_periods", "Financial Periods");
    return card("Budgets &amp; financial periods", "Planned for the next phase. Fiscal year start is already under General & Currency.",
      '<p class="fs-note">You can already set <strong>financial year start</strong> and <strong>lock closed periods</strong> (' + esc(periods.start || "January") + ', lock ' + (periods.lock !== false ? "on" : "off") + ').</p>' +
      soon(["Budget categories with monthly and annual amounts", "Budget warning thresholds", "Period start / end and closing", "Reopen a closed period with authorization"]));
  }

  function renderPayroll(ctx) {
    var post = formOf(ctx, "9_payroll_finance_posting", "Payroll Finance Posting");
    var body =
      card("Payroll posting to Finance", "Calculations and overtime stay in HR & Crew. Finance only receives approved runs.",
        '<div class="fs-fields cols-2">' +
          '<div class="fld"><label for="fsPayCat">Payroll expense category</label><input id="fsPayCat" value="' + esc(post.expenseCategory || "Salaries") + '"></div>' +
          '<div class="fld"><label for="fsPayAcc">Salary expense account</label><input id="fsPayAcc" value="' + esc(post.account || "Payroll clearing") + '"></div>' +
          '<div class="fld"><label for="fsPayMeth">Payroll payment method</label><select id="fsPayMeth"><option' + ((post.method || "Bank transfer") === "Bank transfer" ? " selected" : "") + '>Bank transfer</option><option' + (post.method === "Cash" ? " selected" : "") + '>Cash</option></select></div>' +
          '<div class="fld"><label for="fsPayPost">Payroll posting period</label><select id="fsPayPost"><option>Pay period end</option><option>Pay day</option><option>Manual</option></select></div>' +
          '<label class="fs-toggle block"><input type="checkbox" id="fsPayApproved"' + (post.exportOnlyApproved !== false ? " checked" : "") + '> Only export approved payroll runs</label>' +
        '</div>' +
        '<p class="fs-note">Overtime rules and pay cycles are in <a href="hr.html#payroll/settings/pay">Payroll &amp; Overtime → Settings</a>.</p>',
        ctx.canEdit ? '<button type="button" class="primary-btn" id="fsSavePay">Save posting rules</button>' : "");
    setTimeout(function () {
      if (!ctx.canEdit) return;
      var sel = document.getElementById("fsPayPost");
      if (sel) sel.value = post.posting || "Pay period end";
      bindSave(ctx, "fsSavePay", function () {
        return save(ctx, "9_payroll_finance_posting", {
          expenseCategory: document.getElementById("fsPayCat").value,
          account: document.getElementById("fsPayAcc").value,
          method: document.getElementById("fsPayMeth").value,
          posting: document.getElementById("fsPayPost").value,
          exportOnlyApproved: document.getElementById("fsPayApproved").checked
        });
      });
    }, 0);
    return body;
  }

  function renderReports(ctx) {
    var pref = formOf(ctx, "9_financial_report_preferences", "Financial Report Preferences");
    var body =
      card("Report preferences", "Defaults when generating finance reports.",
        '<div class="fs-fields cols-2">' +
          '<div class="fld"><label for="fsRepRange">Default report period</label><select id="fsRepRange"><option>This month</option><option>Last month</option><option>This quarter</option><option>This year</option></select></div>' +
          '<div class="fld"><label for="fsRepFmt">Export format</label><select id="fsRepFmt"><option>PDF</option><option>Excel</option><option>CSV</option></select></div>' +
          '<label class="fs-toggle block"><input type="checkbox" id="fsRepZero"' + (pref.zero ? " checked" : "") + '> Show zero lines</label>' +
          '<label class="fs-toggle block"><input type="checkbox" id="fsRepUnpaid"' + (pref.trackUnpaid !== false ? " checked" : "") + '> Unpaid invoice tracking</label>' +
          '<label class="fs-toggle block"><input type="checkbox" id="fsRepRec"' + (pref.reconcileRules !== false ? " checked" : "") + '> Apply payment reconciliation rules</label>' +
        '</div>',
        ctx.canEdit ? '<button type="button" class="primary-btn" id="fsSaveRep">Save preferences</button>' : "") +
      card("Coming in this phase", "", soon(["Revenue and expense summary templates", "Payment reconciliation workspace", "Scheduled report delivery"]));
    setTimeout(function () {
      if (!ctx.canEdit) return;
      document.getElementById("fsRepRange").value = pref.range || "This month";
      document.getElementById("fsRepFmt").value = pref.format || "PDF";
      bindSave(ctx, "fsSaveRep", function () {
        return save(ctx, "9_financial_report_preferences", {
          range: document.getElementById("fsRepRange").value,
          format: document.getElementById("fsRepFmt").value,
          zero: document.getElementById("fsRepZero").checked,
          trackUnpaid: document.getElementById("fsRepUnpaid").checked,
          reconcileRules: document.getElementById("fsRepRec").checked
        });
      });
    }, 0);
    return body;
  }

  var RENDERERS = {
    general: renderGeneral,
    categories: renderCategories,
    payments: renderPayments,
    invoices: renderInvoices,
    tax: renderTax,
    approvals: renderApprovals,
    budgets: renderBudgets,
    payroll: renderPayroll,
    reports: renderReports
  };

  function render(ctx) {
    var section = ctx.section || "general";
    if (!SECTIONS.some(function (s) { return s.id === section; })) section = "general";
    var html = shell(section, '<div id="fsToast" class="fs-toast" hidden></div>' + (RENDERERS[section] || renderGeneral)(api(ctx)));
    return html;
  }

  window.VeyoraFinanceSettings = {
    sections: SECTIONS,
    render: render,
    defaultSection: "general"
  };
})();
