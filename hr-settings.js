/* Settings that belong to an HR page, edited on that page (same idea as Leave → Settings).
   There is no separate list of every HR setting. Each area saves the same setting keys as before. */
(function () {
  var AREAS = {
    employees: { hash: "#employees/settings/",
      pills: [
        ["ids", "Staff IDs", "Prefix and first number for staff login IDs", "Employee ID Format", "2_employee_id_format", "base"],
        ["cats", "Staff categories", "Groups such as permanent, contract and casual", "Staff Categories", "8_staff_categories", "base"],
        ["types", "Employment types", "Full-time, part-time and so on", "Employment Types", "2_employment_types", "base"],
        ["directory", "Directory", "Tabs, filters and columns on Employees", "Directory Tabs, Filters & Columns", "8_directory_tabs_filters_and_columns"],
        ["docs", "Document categories", "Groups for files on an employee profile", "HR Document Categories", "8_hr_document_categories"],
        ["approvers", "Approvers", "Named people for payroll, crew assignments and maintenance", "Approvers & Responsibilities", "8_approvers_and_responsibilities", "approvers"]
      ] },
    attendance: { hash: "#attendance/settings/",
      pills: [["rules", "Attendance rules", "Late, absent, location, corrections and breaks", "Attendance Rules", "8_attendance_rules"]] },
    roster: { hash: "#settings/",
      pills: [
        ["shifts", "Shift definitions", "Codes, times, colours and how many people each shift needs", "Shift Definitions", "8_shift_definitions"],
        ["swaps", "Shift swaps", "Who staff can swap with, and whether a swap needs approval", "Shift Swap Rules", "8_shift_swap_rules"],
        ["patterns", "Roster patterns", "Repeating rotations used from the Templates tab", "Roster Patterns", "8_roster_patterns"],
        ["roster", "Roster options", "Weekend, locking past days and warnings", "Duty Roster", "8_duty_roster"],
        ["hours", "Duty hours", "Daily and weekly limits, rest and days in a row", "Duty Hours", "8_duty_hours"]
      ] },
    crew: { hash: "#crew/settings/",
      pills: [
        ["quals", "Qualifications", "Certificates and licences the company records", "Crew Qualification Types", "8_crew_qualification_types"],
        ["expiry", "Expiry alerts", "When to warn before a certificate runs out", "License & Certificate Expiry Alerts", "8_license_and_certificate_expiry_alerts"],
        ["assign", "Assignment rules", "Qualifications, expired certificates, rest and minimum crew", "Crew Assignment Rules", "8_crew_assignment_rules"]
      ] },
    payroll: { hash: "#payroll/settings/",
      pills: [
        ["pay", "Payroll", "Pay period, the company account the bank debits, and who must approve", "Payroll Configuration", "8_payroll_configuration"],
        ["overtime", "Overtime", "When overtime starts and the rates", "Overtime Rules", "8_overtime_rules"]
      ] },
    agreements: { hash: "#settings/",
      pills: [
        ["categories", "Categories", "Groups for templates and agreements", "Agreement Categories", "16_agreement_categories"],
        ["numbering", "Numbering", "How agreement numbers are made", "Agreement Numbering", "16_agreement_numbering"],
        ["pdf", "PDF layout", "Page size, logo and footer on the saved PDF", "Agreement PDF Layout", "16_agreement_pdf_layout"],
        ["reminders", "Reminders", "When a signed agreement counts as ending soon", "Agreement Reminders", "16_agreement_reminders"]
      ] }
  };

  /* Old HR Settings hub (hr.html#settings/…) sent here so saved links still open. */
  var LEGACY = {
    "settings": "#employees/settings",
    "settings/people": "#employees/settings",
    "settings/people/ids": "#employees/settings/ids",
    "settings/people/cats": "#employees/settings/cats",
    "settings/people/emptypes": "#employees/settings/types",
    "settings/people/directory": "#employees/settings/directory",
    "settings/people/docs": "#employees/settings/docs",
    "settings/people/org": "#organization",
    "settings/time": "#attendance/settings/rules",
    "settings/time/attendance": "#attendance/settings/rules",
    "settings/time/shifts": "roster.html#settings/shifts",
    "settings/time/swaps": "roster.html#settings/swaps",
    "settings/time/roster": "roster.html#settings/roster",
    "settings/time/patterns": "roster.html#settings/patterns",
    "settings/time/hours": "roster.html#settings/hours",
    "settings/leave": "#leave/settings/types",
    "settings/leave/all": "#leave/settings/types",
    "settings/pay": "#payroll/settings/pay",
    "settings/pay/payroll": "#payroll/settings/pay",
    "settings/pay/overtime": "#payroll/settings/overtime",
    "settings/pay/allow": "#payroll/rules",
    "settings/pay/catalog": "#allowances",
    "settings/crew": "#crew/settings/quals",
    "settings/crew/quals": "#crew/settings/quals",
    "settings/crew/expiry": "#crew/settings/expiry",
    "settings/crew/assign": "#crew/settings/assign",
    "settings/duties": "#employees/settings/approvers",
    "settings/duties/duties": "#employees/settings/approvers"
  };

  /* Where the company Settings page should send someone who opens an HR item. */
  var HOME = {
    "Employee ID Format": "hr.html#employees/settings/ids",
    "Staff Categories": "hr.html#employees/settings/cats",
    "Employee Categories": "hr.html#employees/settings/cats",
    "Employment Types": "hr.html#employees/settings/types",
    "Directory Tabs, Filters & Columns": "hr.html#employees/settings/directory",
    "HR Document Categories": "hr.html#employees/settings/docs",
    "Approvers & Responsibilities": "hr.html#employees/settings/approvers",
    "Attendance Rules": "hr.html#attendance/settings/rules",
    "Shift Definitions": "roster.html#settings/shifts",
    "Shift Swap Rules": "roster.html#settings/swaps",
    "Roster Patterns": "roster.html#settings/patterns",
    "Duty Roster": "roster.html#settings/roster",
    "Duty Hours": "roster.html#settings/hours",
    "Leave Types & Policies": "hr.html#leave/settings/types",
    "Leave Approval Workflow": "hr.html#leave/settings/workflow",
    "Leave Approval Notifications": "hr.html#leave/settings/notify",
    "Crew Qualification Types": "hr.html#crew/settings/quals",
    "License & Certificate Expiry Alerts": "hr.html#crew/settings/expiry",
    "Crew Assignment Rules": "hr.html#crew/settings/assign",
    "Payroll Configuration": "hr.html#payroll/settings/pay",
    "Overtime Rules": "hr.html#payroll/settings/overtime",
    "Allowance Rules": "hr.html#payroll/rules",
    "Agreement Categories": "hr.html#documents/agreements/settings/categories",
    "Agreement Numbering": "hr.html#documents/agreements/settings/numbering",
    "Agreement PDF Layout": "hr.html#documents/agreements/settings/pdf",
    "Agreement Reminders": "hr.html#documents/agreements/settings/reminders"
  };

  function mount(el, env) {
    var area = AREAS[env.area];
    if (!area) { el.innerHTML = '<p class="msg">Unknown settings area.</p>'; return; }
    var esc = env.esc, company = env.company(), edit = !!env.canHr;
    var pill = area.pills.filter(function (p) { return p[0] === env.pill; })[0] ? env.pill : area.pills[0][0];
    function save(key, val) {
      return env.rpc("set_company_setting", { p_company: company.id, p_key: key, p_value: val }).then(function () {
        company.settings = company.settings || {}; company.settings[key] = val;
        if (env.onSaved) env.onSaved(key);
      });
    }
    var navHash = env.hash || area.hash;
    var tabs = area.pills.length < 2 ? "" : '<div class="hr-tabs" role="tablist">' + area.pills.map(function (p) {
      return '<a href="' + navHash + p[0] + '"' + (p[0] === pill ? ' class="on" aria-current="page"' : "") + '>' + esc(p[1]) + '</a>';
    }).join("") + '</div>';
    el.innerHTML = '<div class="ls hr-set">' + tabs + '<div class="ls-body" id="hrSetBody"></div></div>';
    var body = document.getElementById("hrSetBody");
    var cur = area.pills.filter(function (p) { return p[0] === pill; })[0];
    var title = cur[3], key = cur[4], kind = cur[5] || "engine";
    if (kind === "approvers") {
      window.VeyoraApprovers.render(body, { ctx: { key: key }, header: function () { return ""; }, mode: "duties", edit: edit, company: env.company, orgLoad: env.orgLoad,
        memberName: env.memberName, optList: env.optList, esc: esc, crewGroups: ["Captain", "Deck", "Engineering", "Shore", "Other"], save: save });
      return;
    }
    var defs = window.VEYORA_DEFS || {}, spec = defs[title];
    if (kind === "base" && spec && spec.base) spec = spec.base;
    window.VeyoraEngine.render(body, { title: title, spec: spec, key: key, canEdit: edit, embed: true, help: (window.VEYORA_HELP || {})[title],
      value: company.settings ? company.settings[key] : undefined, company: company, db: env.db,
      save: function (v) { return save(key, v); } });
    if (!edit) body.insertAdjacentHTML("afterbegin", '<p class="msg">Only owners, admins and HR can change this.</p>');
  }

  window.HrSettings = { mount: mount, legacy: function (raw) { return LEGACY[raw] || ""; }, home: function (title) { return HOME[title] || ""; } };
})();
