/* Which steps a new company walks through. The platform owner ticks the built-in steps and can add other settings.
   Stored in platform_settings.config.onboarding_progress. Companies read it through onboarding_progress(). */
(function () {
  function slug(t) {
    return String(t || "").toLowerCase().replace(/&/g, "and").replace(/[^a-z0-9]+/g, "_").replace(/^_|_$/g, "").slice(0, 48);
  }
  var BUILTIN = [
    { id: "company", label: "Company", tip: "Profile details", banner: "Company details" },
    { id: "org", label: "Organisation", tip: "Depts & titles", banner: "Departments & designations" },
    { id: "access", label: "Access", tip: "Who sees what", banner: "Access control" },
    { id: "depts", label: "Departments", tip: "Per-team setup", banner: "Department details" },
    { id: "payroll", label: "Payroll", tip: "Pay & bank", banner: "Payroll" },
    { id: "arrival", label: "Cash", tip: "Cash approval", banner: "Cash booking approval" }
  ];
  var OLD = ["company", "org", "access", "depts", "payroll", "arrival"];
  /* Settings that are not inside a grouped tab, with the key they already save under. */
  var OWN = [
    ["Employee ID Format", "2_employee_id_format", "Employees"],
    ["Staff Categories", "8_staff_categories", "Employees"],
    ["Employee Categories", "8_staff_categories", "Employees"],
    ["Employment Types", "2_employment_types", "Employees"],
    ["Directory Tabs, Filters & Columns", "8_directory_tabs_filters_and_columns", "Employees"],
    ["HR Document Categories", "8_hr_document_categories", "Employees"],
    ["Attendance Rules", "8_attendance_rules", "Attendance"],
    ["Shift Definitions", "8_shift_definitions", "Roster"],
    ["Shift Swap Rules", "8_shift_swap_rules", "Roster"],
    ["Roster Patterns", "8_roster_patterns", "Roster"],
    ["Duty Roster", "8_duty_roster", "Roster"],
    ["Duty Hours", "8_duty_hours", "Roster"],
    ["Leave Types & Policies", "8_leave_types_and_policies", "Leave"],
    ["Leave Approval Workflow", "8_leave_approval_workflow", "Leave"],
    ["Crew Qualification Types", "8_crew_qualification_types", "Crew"],
    ["License & Certificate Expiry Alerts", "8_license_and_certificate_expiry_alerts", "Crew"],
    ["Crew Assignment Rules", "8_crew_assignment_rules", "Crew"],
    ["Payroll Configuration", "8_payroll_configuration", "Payroll"],
    ["Overtime Rules", "8_overtime_rules", "Payroll"],
    ["Agreement Categories", "16_agreement_categories", "Agreements"],
    ["Agreement Numbering", "16_agreement_numbering", "Agreements"],
    ["Agreement PDF Layout", "16_agreement_pdf_layout", "Agreements"],
    ["Agreement Reminders", "16_agreement_reminders", "Agreements"],
    ["Base Currency", "9_base_currency", "Finance"],
    ["Supported Currencies", "9_supported_currencies", "Finance"],
    ["Financial Periods", "9_financial_periods", "Finance"],
    ["Revenue Categories", "9_revenue_categories", "Finance"],
    ["Expense Categories", "9_expense_categories", "Finance"],
    ["Category Defaults", "9_category_defaults", "Finance"],
    ["Payment Methods", "9_payment_methods", "Finance"],
    ["Finance Accounts", "9_finance_accounts", "Finance"],
    ["Reconciliation Settings", "9_reconciliation_settings", "Finance"],
    ["Invoice Number Format", "9_invoice_number_format", "Finance"],
    ["Receipt Number Format", "9_receipt_number_format", "Finance"],
    ["Document Branding", "9_document_branding", "Finance"],
    ["Payment Terms", "9_payment_terms", "Finance"],
    ["Tax Configuration", "9_tax_configuration", "Finance"],
    ["Tax Rates", "9_tax_rates", "Finance"],
    ["Financial Approval Limits", "9_financial_approval_limits", "Finance"],
    ["Payroll Finance Posting", "9_payroll_finance_posting", "Finance"],
    ["Financial Report Preferences", "9_financial_report_preferences", "Finance"]
  ];
  var OK = { form: 1, list: 1, table: 1, matrix: 1 };

  function choices() {
    var defs = window.VEYORA_DEFS || {};
    var seen = {};
    var list = [];
    function add(title, key, group) {
      if (!title || !key || seen[key] || !/^[a-z0-9_]{1,60}$/.test(key)) return;
      var spec = defs[title];
      if (!spec || !OK[spec.type]) return;
      seen[key] = 1;
      list.push({ title: title, key: key, group: group || "Settings" });
    }
    Object.keys(defs).forEach(function (name) {
      var spec = defs[name];
      if (!spec || spec.type !== "group" || !spec.tabs) return;
      spec.tabs.forEach(function (t) { add(t[2], t[3] + "_" + slug(t[2]), name); });
    });
    OWN.forEach(function (row) { add(row[0], row[1], row[2]); });
    list.sort(function (a, b) { return (a.group + a.title).localeCompare(b.group + b.title); });
    return list;
  }

  function cleanExtra(raw) {
    var out = [];
    var seen = {};
    (Array.isArray(raw) ? raw : []).forEach(function (row) {
      if (!row || typeof row !== "object") return;
      var title = String(row.title || "").slice(0, 80);
      var key = String(row.key || "");
      if (!title || !/^[a-z0-9_]{1,60}$/.test(key) || seen[key]) return;
      seen[key] = 1;
      out.push({ title: title, key: key });
    });
    return out;
  }

  function resolve(raw) {
    var picked = raw && Array.isArray(raw.builtin) ? raw.builtin : null;
    var steps = BUILTIN.filter(function (b) { return !picked || picked.indexOf(b.id) >= 0; }).map(function (b) {
      return { id: b.id, label: b.label, tip: b.tip, banner: b.banner, kind: "builtin" };
    });
    cleanExtra(raw && raw.extra).forEach(function (row) {
      steps.push({ id: "set:" + row.key, label: row.title, tip: "Company setting", banner: row.title, kind: "setting", title: row.title, key: row.key });
    });
    if (!steps.length) {
      return BUILTIN.map(function (b) {
        return { id: b.id, label: b.label, tip: b.tip, banner: b.banner, kind: "builtin" };
      });
    }
    return steps;
  }

  function done(w) {
    if (!w || typeof w !== "object") return false;
    if (w.done === true || w.done === "true" || w.done === 1) return true;
    if (!w.stepId && Number(w.phase) >= 6) return true;
    return false;
  }

  function place(w, steps) {
    w = w && typeof w === "object" ? w : {};
    var i;
    if (w.stepId) {
      for (i = 0; i < steps.length; i++) if (steps[i].id === w.stepId) return i;
    }
    var old = Math.min(OLD.length - 1, Math.max(0, Number(w.phase) || 0));
    for (i = old; i < OLD.length; i++) {
      for (var k = 0; k < steps.length; k++) if (steps[k].id === OLD[i]) return k;
    }
    for (i = old; i >= 0; i--) {
      for (var n = 0; n < steps.length; n++) if (steps[n].id === OLD[i]) return n;
    }
    return 0;
  }

  function esc(s) {
    return String(s == null ? "" : s).replace(/[&<>"']/g, function (c) {
      return { "&": "&amp;", "<": "&lt;", ">": "&gt;", '"': "&quot;", "'": "&#39;" }[c];
    });
  }

  function editorHtml(saved) {
    var builtin = saved && Array.isArray(saved.builtin) ? saved.builtin : null;
    var extra = cleanExtra(saved && saved.extra);
    var have = {};
    extra.forEach(function (row) { have[row.key] = 1; });
    var checks = BUILTIN.map(function (b) {
      var on = !builtin || builtin.indexOf(b.id) >= 0;
      return '<label class="lk-auto"><input type="checkbox" data-ob-on="' + b.id + '"' + (on ? " checked" : "") + "> <span><strong>" + esc(b.label) + "</strong><small>" + esc(b.tip) + "</small></span></label>";
    }).join("");
    var added = extra.map(function (row) {
      return '<li class="row" data-ob-extra="' + esc(row.key) + '" data-ob-title="' + esc(row.title) + '"><span class="grow"><strong>' + esc(row.title) + '</strong></span><button type="button" class="ghost" data-ob-rm="' + esc(row.key) + '">Remove</button></li>';
    }).join("");
    var opts = choices().filter(function (c) { return !have[c.key]; }).map(function (c) {
      return '<option value="' + esc(c.key) + '" data-title="' + esc(c.title) + '">' + esc(c.group + " — " + c.title) + "</option>";
    }).join("");
    var line = resolve(saved).map(function (s) { return s.label; }).join(" → ");
    return '<h2>Onboarding progress</h2><p class="note">Tick the steps a new company walks through. Add any other setting and it is asked at the end of that progress.</p>' +
      '<div class="ob-pick">' + checks + "</div>" +
      (added ? '<h3>Added settings</h3><ul class="rows" id="obExtra">' + added + "</ul>" : '<ul class="rows" id="obExtra" hidden></ul>') +
      '<div class="inv" style="margin-top:12px"><select id="obAdd" aria-label="Setting to add"><option value="">Add a setting…</option>' + opts + '</select><button type="button" class="ghost" id="obAddBtn">Add to progress</button></div>' +
      '<p class="note" id="obPreview">Companies will see: ' + esc(line) + '</p>' +
      '<div class="actions"><span class="msg" id="obProgMsg"></span><button type="button" class="save" id="obSaveProg">Save onboarding progress</button></div>';
  }

  function read(root) {
    if (!root) return { builtin: BUILTIN.map(function (b) { return b.id; }), extra: [] };
    var builtin = [];
    [].forEach.call(root.querySelectorAll("[data-ob-on]"), function (el) {
      if (el.checked) builtin.push(el.getAttribute("data-ob-on"));
    });
    var extra = [];
    [].forEach.call(root.querySelectorAll("[data-ob-extra]"), function (el) {
      extra.push({ title: el.getAttribute("data-ob-title"), key: el.getAttribute("data-ob-extra") });
    });
    return { builtin: builtin, extra: cleanExtra(extra) };
  }

  window.VeyoraOnboarding = {
    builtin: BUILTIN,
    choices: choices,
    resolve: resolve,
    done: done,
    place: place,
    editorHtml: editorHtml,
    read: read
  };
})();
