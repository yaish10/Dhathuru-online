/* Cursor 2026-10-23: first-run company setup wizard → finishes on Fleet (vessels). */
(function () {
  var db = window.veyoraDb;
  var VIEW_KEY = "veyora-view-company";
  var WIZARD_KEY = "0_setup_wizard";
  var MODULE_KEY = "1_module_access";
  var DEPT_ACCESS_KEY = "1_department_access";
  var DEPT_MOD_KEY = "0_setup_dept_modules";

  var PHASES = [
    { id: "company", label: "Company", tip: "Profile details" },
    { id: "org", label: "Organisation", tip: "Depts & titles" },
    { id: "access", label: "Access", tip: "Who sees what" },
    { id: "depts", label: "Departments", tip: "Per-team setup" },
    { id: "payroll", label: "Payroll", tip: "Pay & bank" }
  ];

  /* Cursor 2026-10-23: companies type their own depts/titles — optional ideas only, never pre-filled. */
  var EXAMPLE_DEPTS = ["Operations", "Fleet", "Passenger Services", "HR", "IT", "Finance", "Maintenance"];
  var MODULES = ["Dashboard", "Operations", "Schedules", "Fleet", "Passengers", "HR & Crew", "IT", "Finance", "Maintenance", "Reports", "Settings"];
  var ROLES = ["Admin", "Operations", "HR", "IT", "Staff"];

  var DEPT_MODULE_DEFAULT = {
    "Operations": ["Dashboard", "Operations", "Schedules", "Fleet", "Passengers", "Maintenance", "Reports"],
    "Fleet": ["Dashboard", "Fleet", "Maintenance", "Schedules", "Reports"],
    "Passenger Services": ["Dashboard", "Passengers", "Schedules", "Operations"],
    "HR": ["Dashboard", "HR & Crew", "Reports"],
    "IT": ["Dashboard", "IT", "Settings"],
    "Finance": ["Dashboard", "Finance", "Reports"],
    "Maintenance": ["Dashboard", "Maintenance", "Fleet", "Reports"]
  };

  function modulesForDept(name) {
    if (DEPT_MODULE_DEFAULT[name]) return DEPT_MODULE_DEFAULT[name].slice();
    var n = String(name || "").toLowerCase();
    if (/hr|human|crew|people/.test(n)) return DEPT_MODULE_DEFAULT.HR.slice();
    if (/fleet|vessel|marine/.test(n)) return DEPT_MODULE_DEFAULT.Fleet.slice();
    if (/ops|operation|dispatch/.test(n)) return DEPT_MODULE_DEFAULT.Operations.slice();
    if (/it|tech|system/.test(n)) return DEPT_MODULE_DEFAULT.IT.slice();
    if (/financ|account|pay/.test(n)) return DEPT_MODULE_DEFAULT.Finance.slice();
    if (/maint|engineer|tech/.test(n)) return DEPT_MODULE_DEFAULT.Maintenance.slice();
    if (/passenger|ticket|pax/.test(n)) return DEPT_MODULE_DEFAULT["Passenger Services"].slice();
    return ["Dashboard"];
  }

  function roleForDept(name) {
    if (name === "HR") return "HR";
    if (name === "IT") return "IT";
    if (name === "Finance") return "Admin";
    if (name === "Operations" || name === "Fleet" || name === "Passenger Services" || name === "Maintenance") return "Operations";
    var n = String(name || "").toLowerCase();
    if (/hr|human|crew|people/.test(n)) return "HR";
    if (/it|tech|system/.test(n)) return "IT";
    if (/financ|account/.test(n)) return "Admin";
    if (/ops|operation|fleet|vessel|maint|passenger|ticket|dispatch/.test(n)) return "Operations";
    return "Staff";
  }

  var TYPES = ["Ferry Operator", "Speedboat Operator", "Both", "Other"];
  var CURRENCIES = ["MVR", "USD", "EUR", "GBP", "LKR", "INR", "AED", "SGD"];
  var TIMEZONES = ["Indian/Maldives", "Asia/Colombo", "Asia/Dubai", "Asia/Kolkata", "Asia/Singapore", "Europe/London", "UTC"];
  var DATE_FMTS = ["DD MMM YYYY", "DD/MM/YYYY", "MM/DD/YYYY", "YYYY-MM-DD"];
  var LANGS = ["English", "Dhivehi"];
  var PAY_CYCLES = ["Monthly", "Fortnightly", "Weekly"];
  var PAY_DAYS = [];
  for (var pd = 1; pd <= 28; pd++) PAY_DAYS.push(String(pd));
  var PAY_ENDS = ["End of the month"].concat(PAY_DAYS);
  /* Banks licensed to operate in the Maldives (same list as Add Employee). */
  var MV_BANKS = [
    "Bank of Ceylon",
    "Bank of Maldives",
    "Commercial Bank of Maldives",
    "Development Bank of Maldives",
    "Habib Bank Limited",
    "Maldives Islamic Bank",
    "Maldives Premier Bank",
    "State Bank of India",
    "The Mauritius Commercial Bank"
  ];

  var state = {
    company: null,
    userId: null,
    role: null,
    phase: 0,
    deptPhaseIdx: 0,
    selectedDepts: [],
    selectedTitles: {},
    deptModules: {},
    deptDetails: {},
    busy: false
  };

  var els = {
    main: document.getElementById("obMain"),
    foot: document.getElementById("obFoot"),
    back: document.getElementById("obBack"),
    next: document.getElementById("obNext"),
    skip: document.getElementById("obSkip"),
    progress: document.getElementById("obProgress"),
    companyName: document.getElementById("obCompanyName"),
    toast: document.getElementById("obToast")
  };

  function esc(s) {
    return String(s == null ? "" : s)
      .replace(/&/g, "&amp;").replace(/</g, "&lt;").replace(/>/g, "&gt;")
      .replace(/"/g, "&quot;");
  }

  function toast(msg, kind) {
    els.toast.hidden = false;
    els.toast.className = "ob-toast" + (kind === "err" ? " err" : kind === "ok" ? " ok" : "");
    els.toast.textContent = msg;
    clearTimeout(toast._t);
    toast._t = setTimeout(function () { els.toast.hidden = true; }, 3200);
  }

  function opts(list, cur) {
    return list.map(function (o) {
      return '<option value="' + esc(o) + '"' + (o === cur ? " selected" : "") + ">" + esc(o) + "</option>";
    }).join("");
  }

  function saveSetting(key, val) {
    return db.rpc("set_company_setting", { p_company: state.company.id, p_key: key, p_value: val }).then(function (r) {
      if (r.error) throw new Error(r.error.message);
      state.company.settings = state.company.settings || {};
      state.company.settings[key] = val;
    });
  }

  function wizardBlob() {
    var s = (state.company.settings && state.company.settings[WIZARD_KEY]) || {};
    return {
      phase: state.phase,
      deptPhaseIdx: state.deptPhaseIdx,
      selectedDepts: state.selectedDepts.slice(),
      selectedTitles: state.selectedTitles,
      deptModules: state.deptModules,
      deptDetails: state.deptDetails,
      started: s.started !== false,
      startedAt: s.startedAt || new Date().toISOString(),
      done: !!s.done,
      updatedAt: new Date().toISOString()
    };
  }

  function persistProgress(extra) {
    var blob = wizardBlob();
    if (extra) Object.keys(extra).forEach(function (k) { blob[k] = extra[k]; });
    return saveSetting(WIZARD_KEY, blob);
  }

  function renderProgress() {
    els.progress.innerHTML = PHASES.map(function (p, i) {
      var cls = i < state.phase ? "done" : i === state.phase ? "on" : "";
      return '<div class="ob-step ' + cls + '"><span class="n">' + (i < state.phase ? "✓" : (i + 1)) + "</span>" +
        "<div><strong>" + esc(p.label) + "</strong><small>" + esc(p.tip) + "</small></div></div>";
    }).join("");
  }

  /* ---------- Phase 1: company ---------- */
  function renderCompany() {
    var c = state.company;
    els.main.innerHTML =
      '<div class="ob-card">' +
      "<h1>Tell us more about your company</h1>" +
      '<p class="lead">A few details so VEYORA shows the right region, currency and contact info. You can change these later in Settings.</p>' +
      '<div class="ob-grid">' +
      '<div class="ob-fld"><label for="ob_name">Company name</label><input id="ob_name" value="' + esc(c.name) + '"></div>' +
      '<div class="ob-fld"><label for="ob_type">Company type</label><select id="ob_type">' + opts(TYPES, c.type || TYPES[0]) + "</select></div>" +
      '<div class="ob-fld"><label for="ob_region">Operating region</label><input id="ob_region" value="' + esc(c.region || "") + '" placeholder="e.g. Kaafu Atoll, Maldives"></div>' +
      '<div class="ob-fld"><label for="ob_reg">Registration number</label><input id="ob_reg" value="' + esc(c.registration_no || "") + '" placeholder="Optional"></div>' +
      '<div class="ob-fld"><label for="ob_email">Official email</label><input id="ob_email" type="email" value="' + esc(c.email || "") + '"></div>' +
      '<div class="ob-fld"><label for="ob_phone">Contact number</label><input id="ob_phone" value="' + esc(c.phone || "") + '"></div>' +
      '<div class="ob-fld full"><label for="ob_addr">Office address</label><textarea id="ob_addr" rows="2">' + esc(c.address || "") + "</textarea></div>" +
      '<div class="ob-fld"><label for="ob_cur">Currency</label><select id="ob_cur">' + opts(CURRENCIES, c.currency || "MVR") + "</select></div>" +
      '<div class="ob-fld"><label for="ob_tz">Time zone</label><select id="ob_tz">' + opts(TIMEZONES, c.timezone || "Indian/Maldives") + "</select></div>" +
      '<div class="ob-fld"><label for="ob_df">Date format</label><select id="ob_df">' + opts(DATE_FMTS, c.date_format || "DD MMM YYYY") + "</select></div>" +
      '<div class="ob-fld"><label for="ob_lang">Language</label><select id="ob_lang">' + opts(LANGS, c.language || "English") + "</select></div>" +
      "</div></div>";
    els.back.hidden = true;
    els.skip.hidden = true;
    els.next.textContent = "Continue";
    els.foot.hidden = false;
  }

  function saveCompanyPhase() {
    var name = document.getElementById("ob_name").value.trim();
    var email = document.getElementById("ob_email").value.trim();
    if (name.length < 2) throw new Error("Enter the company name.");
    if (email && !/^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(email)) throw new Error("Enter a valid email, or leave it blank.");
    var patch = {
      name: name,
      type: document.getElementById("ob_type").value,
      region: document.getElementById("ob_region").value.trim() || null,
      registration_no: document.getElementById("ob_reg").value.trim() || null,
      email: email || null,
      phone: document.getElementById("ob_phone").value.trim() || null,
      address: document.getElementById("ob_addr").value.trim() || null,
      currency: document.getElementById("ob_cur").value,
      timezone: document.getElementById("ob_tz").value,
      date_format: document.getElementById("ob_df").value,
      language: document.getElementById("ob_lang").value
    };
    return db.from("companies").update(patch).eq("id", state.company.id).select().single().then(function (r) {
      if (r.error) throw new Error(r.error.message);
      state.company = Object.assign(state.company, r.data);
      els.companyName.textContent = state.company.name;
      return persistProgress({ phase: 1 });
    });
  }

  /* ---------- Phase 2: depts & titles (company-defined) ---------- */
  function pruneTitles() {
    Object.keys(state.selectedTitles).forEach(function (d) {
      if (state.selectedDepts.indexOf(d) < 0) delete state.selectedTitles[d];
    });
  }

  function addDept(name) {
    name = String(name || "").trim();
    if (!name) return false;
    if (state.selectedDepts.some(function (d) { return d.toLowerCase() === name.toLowerCase(); })) {
      toast("That department is already listed.", "err");
      return false;
    }
    state.selectedDepts.push(name);
    state.selectedTitles[name] = state.selectedTitles[name] || [];
    return true;
  }

  function addTitle(dept, title) {
    title = String(title || "").trim();
    if (!title) return false;
    state.selectedTitles[dept] = state.selectedTitles[dept] || [];
    if (state.selectedTitles[dept].some(function (x) { return x.toLowerCase() === title.toLowerCase(); })) {
      toast("Already added.", "err");
      return false;
    }
    state.selectedTitles[dept].push(title);
    return true;
  }

  function renderOrg() {
    pruneTitles();
    var unusedIdeas = EXAMPLE_DEPTS.filter(function (d) {
      return !state.selectedDepts.some(function (x) { return x.toLowerCase() === d.toLowerCase(); });
    });

    var titleBlocks = state.selectedDepts.map(function (d) {
      var titles = state.selectedTitles[d] || [];
      return '<div class="ob-dept-card" data-dept="' + esc(d) + '">' +
        '<header class="ob-dept-head"><h3>' + esc(d) + '</h3>' +
        '<button type="button" class="ob-ghost ob-dept-rm" data-remove-dept="' + esc(d) + '">Remove</button></header>' +
        '<p class="hint">Add job titles / designations for this team</p>' +
        '<div class="ob-chips" data-titles="' + esc(d) + '">' +
        (titles.length
          ? titles.map(function (t) {
            return '<button type="button" class="ob-chip on" data-title="' + esc(t) + '">' + esc(t) + " ×</button>";
          }).join("")
          : '<span class="ob-empty-hint">No designations yet</span>') +
        "</div>" +
        '<div class="ob-add-row"><input placeholder="e.g. Captain, Dispatcher" data-add-title="' + esc(d) + '">' +
        '<button type="button" data-add-btn="' + esc(d) + '">Add</button></div></div>';
    }).join("");

    els.main.innerHTML =
      '<div class="ob-card">' +
      "<h1>Departments &amp; designations</h1>" +
      '<p class="lead">Add the teams your company uses — use your own names. Designations are optional and can be finished later in HR.</p>' +
      '<div class="ob-add-row ob-add-dept">' +
      '<input id="obNewDept" placeholder="Department name, e.g. Shore Ops" autocomplete="off">' +
      '<button type="button" id="obAddDept" class="ob-primary-mini">Add department</button></div>' +
      (unusedIdeas.length
        ? '<p class="ob-ideas-lab">Optional ideas — tap to add</p><div class="ob-chips ob-ideas" id="obDeptIdeas">' +
          unusedIdeas.map(function (d) {
            return '<button type="button" class="ob-chip soft" data-idea-dept="' + esc(d) + '">+ ' + esc(d) + "</button>";
          }).join("") +
          "</div>"
        : "") +
      '<div class="ob-org-list">' +
      (titleBlocks ||
        '<div class="ob-empty-org"><strong>No departments yet</strong><p>Type a name above and add your first team.</p></div>') +
      "</div></div>";

    els.back.hidden = false;
    els.skip.hidden = false;
    els.skip.textContent = "Skip for now";
    els.next.textContent = "Continue";
    els.foot.hidden = false;

    var deptIn = document.getElementById("obNewDept");
    if (deptIn) {
      deptIn.focus();
      deptIn.addEventListener("keydown", function (e) {
        if (e.key === "Enter") {
          e.preventDefault();
          if (addDept(deptIn.value)) renderOrg();
        }
      });
    }
  }

  function onOrgClick(e) {
    if (state.phase !== 1) return;
    var idea = e.target.closest("[data-idea-dept]");
    if (idea) {
      if (addDept(idea.getAttribute("data-idea-dept"))) renderOrg();
      return;
    }
    var rm = e.target.closest("[data-remove-dept]");
    if (rm) {
      var name = rm.getAttribute("data-remove-dept");
      state.selectedDepts = state.selectedDepts.filter(function (d) { return d !== name; });
      delete state.selectedTitles[name];
      delete state.deptModules[name];
      renderOrg();
      return;
    }
    if (e.target.id === "obAddDept" || e.target.closest("#obAddDept")) {
      var n = (document.getElementById("obNewDept") || {}).value;
      if (addDept(n)) renderOrg();
      return;
    }
    var rem = e.target.closest("[data-title]");
    if (rem && rem.closest("[data-titles]")) {
      var dept = rem.closest("[data-titles]").getAttribute("data-titles");
      var t = rem.getAttribute("data-title");
      state.selectedTitles[dept] = (state.selectedTitles[dept] || []).filter(function (x) { return x !== t; });
      renderOrg();
      return;
    }
    var addBtn = e.target.closest("[data-add-btn]");
    if (!addBtn) return;
    var d = addBtn.getAttribute("data-add-btn");
    var input = els.main.querySelector("[data-add-title=\"" + d.replace(/\\/g, "\\\\").replace(/"/g, '\\"') + "\"]");
    if (addTitle(d, input && input.value)) renderOrg();
  }

  function onOrgKey(e) {
    if (state.phase !== 1 || e.key !== "Enter") return;
    var input = e.target.closest("[data-add-title]");
    if (!input) return;
    e.preventDefault();
    if (addTitle(input.getAttribute("data-add-title"), input.value)) renderOrg();
  }

  els.main.addEventListener("click", onOrgClick);
  els.main.addEventListener("keydown", onOrgKey);

  function saveOrgPhase(allowEmpty) {
    pruneTitles();
    if (!allowEmpty && !state.selectedDepts.length) {
      throw new Error("Add at least one department, or skip for now.");
    }
    if (!state.selectedDepts.length) {
      return persistProgress({ phase: 2 });
    }
    return Promise.all([
      db.from("departments").select("id, name").eq("company_id", state.company.id),
      db.from("job_titles").select("id, title, department_id").eq("company_id", state.company.id)
    ]).then(function (r) {
      if (r[0].error) throw new Error(r[0].error.message);
      if (r[1].error) throw new Error(r[1].error.message);
      var haveD = {};
      (r[0].data || []).forEach(function (d) { haveD[d.name.toLowerCase()] = d; });
      var jobs = [];
      var missing = state.selectedDepts.filter(function (n) { return !haveD[n.toLowerCase()]; });
      if (missing.length) {
        jobs.push(db.from("departments").insert(missing.map(function (n) {
          return { company_id: state.company.id, name: n };
        })).then(function (res) {
          if (res.error) throw new Error(res.error.message);
        }));
      }
      return Promise.all(jobs).then(function () {
        return db.from("departments").select("id, name").eq("company_id", state.company.id);
      });
    }).then(function (r) {
      if (r.error) throw new Error(r.error.message);
      var byName = {};
      (r.data || []).forEach(function (d) { byName[d.name.toLowerCase()] = d; });
      return db.from("job_titles").select("id, title").eq("company_id", state.company.id).then(function (tr) {
        if (tr.error) throw new Error(tr.error.message);
        var haveT = {};
        (tr.data || []).forEach(function (t) { haveT[t.title.toLowerCase()] = t; });
        var rows = [];
        state.selectedDepts.forEach(function (d) {
          var dept = byName[d.toLowerCase()];
          (state.selectedTitles[d] || []).forEach(function (title) {
            if (haveT[title.toLowerCase()]) return;
            rows.push({
              company_id: state.company.id,
              title: title,
              department_id: dept ? dept.id : null
            });
            haveT[title.toLowerCase()] = true;
          });
        });
        if (!rows.length) return;
        return db.from("job_titles").insert(rows).then(function (res) {
          if (res.error) throw new Error(res.error.message);
        });
      });
    }).then(function () {
      state.selectedDepts.forEach(function (d) {
        if (!state.deptModules[d]) state.deptModules[d] = modulesForDept(d);
      });
      return persistProgress({ phase: 2 });
    });
  }

  /* ---------- Phase 3: access ---------- */
  function renderAccess() {
    if (!state.selectedDepts.length) {
      goPayroll();
      return;
    }
    state.selectedDepts.forEach(function (d) {
      if (!state.deptModules[d]) state.deptModules[d] = modulesForDept(d);
    });
    els.main.innerHTML =
      '<div class="ob-card">' +
      "<h1>Access control</h1>" +
      '<p class="lead">Choose which parts of VEYORA each department can open. People in that department inherit these modules. Owners and admins always keep full access.</p>' +
      '<div class="ob-access">' +
      state.selectedDepts.map(function (d) {
        var mods = state.deptModules[d] || [];
        return '<div class="ob-role" data-access="' + esc(d) + '"><header><strong>' + esc(d) + "</strong>" +
          "<small>Staff in this department</small></header>" +
          '<div class="ob-mods">' +
          MODULES.map(function (m) {
            var on = mods.indexOf(m) > -1;
            return '<button type="button" class="ob-mod' + (on ? " on" : "") + '" data-mod="' + esc(m) + '">' + esc(m) + "</button>";
          }).join("") +
          "</div></div>";
      }).join("") +
      "</div></div>";

    els.back.hidden = false;
    els.skip.hidden = false;
    els.skip.textContent = "Use defaults";
    els.next.textContent = "Continue";
    els.foot.hidden = false;
  }

  function onAccessClick(e) {
    if (state.phase !== 2) return;
    var btn = e.target.closest("[data-mod]");
    if (!btn) return;
    var card = btn.closest("[data-access]");
    if (!card) return;
    var dept = card.getAttribute("data-access");
    var mod = btn.getAttribute("data-mod");
    var list = state.deptModules[dept] || [];
    var i = list.indexOf(mod);
    if (i > -1) {
      if (mod === "Dashboard") { toast("Dashboard stays on for every team.", "err"); return; }
      list.splice(i, 1);
      btn.classList.remove("on");
    } else {
      list.push(mod);
      btn.classList.add("on");
    }
    state.deptModules[dept] = list;
  }

  els.main.addEventListener("click", onAccessClick);

  function buildRoleMatrices() {
    var moduleAccess = {};
    var deptAccess = {};
    ROLES.forEach(function (role) {
      moduleAccess[role] = {};
      deptAccess[role] = {};
      MODULES.forEach(function (m) { moduleAccess[role][m] = role === "Admin"; });
      state.selectedDepts.forEach(function (d) { deptAccess[role][d] = role === "Admin"; });
    });
    moduleAccess.Staff = moduleAccess.Staff || {};
    MODULES.forEach(function (m) { moduleAccess.Staff[m] = m === "Dashboard"; });

    state.selectedDepts.forEach(function (d) {
      var role = roleForDept(d);
      var mods = state.deptModules[d] || ["Dashboard"];
      mods.forEach(function (m) {
        if (moduleAccess[role]) moduleAccess[role][m] = true;
      });
      if (deptAccess[role]) deptAccess[role][d] = true;
      if (role === "Operations" && deptAccess.Operations) {
        state.selectedDepts.forEach(function (extra) {
          if (roleForDept(extra) === "Operations") deptAccess.Operations[extra] = true;
        });
      }
    });
    return { moduleAccess: moduleAccess, deptAccess: deptAccess };
  }

  function saveAccessPhase() {
    var matrices = buildRoleMatrices();
    return Promise.all([
      saveSetting(DEPT_MOD_KEY, state.deptModules),
      saveSetting(MODULE_KEY, matrices.moduleAccess),
      saveSetting(DEPT_ACCESS_KEY, matrices.deptAccess),
      persistProgress({ phase: 3, deptPhaseIdx: 0 })
    ]);
  }

  /* ---------- Phase 4: per department ---------- */
  function deptQuestions(dept) {
    var common =
      '<div class="ob-fld"><label>Approx. headcount</label><input type="number" min="0" id="dq_head" placeholder="e.g. 8"></div>' +
      '<div class="ob-fld full"><label>Notes for this team</label><textarea id="dq_notes" rows="2" placeholder="Optional"></textarea></div>';
    if (dept === "Operations") {
      return common +
        '<div class="ob-fld"><label>Typical daily sailings</label><input type="number" min="0" id="dq_sail" placeholder="e.g. 12"></div>' +
        '<div class="ob-fld"><label>Peak months</label><input id="dq_peak" placeholder="e.g. Dec–Mar"></div>';
    }
    if (dept === "Fleet") {
      return common +
        '<div class="ob-fld"><label>Vessels to add soon</label><input type="number" min="0" id="dq_vessels" placeholder="e.g. 4"></div>' +
        '<div class="ob-fld"><label>Main vessel types</label><input id="dq_types" placeholder="Ferry, speedboat…"></div>';
    }
    if (dept === "HR") {
      return common +
        '<div class="ob-fld"><label>Attendance method</label><select id="dq_att"><option>Bio-metric</option><option>Mobile app</option><option>Manual</option></select></div>';
    }
    if (dept === "Finance") {
      return common +
        '<div class="ob-fld"><label>Invoice prefix</label><input id="dq_inv" placeholder="INV"></div>';
    }
    if (dept === "Maintenance") {
      return common +
        '<div class="ob-fld"><label>Work model</label><select id="dq_model"><option>In-house</option><option>Contractors</option><option>Mixed</option></select></div>';
    }
    if (dept === "IT") {
      return common +
        '<div class="ob-fld"><label>Devices to manage</label><input type="number" min="0" id="dq_dev" placeholder="e.g. 20"></div>';
    }
    if (dept === "Passenger Services") {
      return common +
        '<div class="ob-fld"><label>Ticket counters / desks</label><input type="number" min="0" id="dq_desk" placeholder="e.g. 2"></div>';
    }
    return common;
  }

  function readDeptQuestions(dept) {
    function v(id) { var el = document.getElementById(id); return el ? el.value.trim() : ""; }
    var out = { headcount: v("dq_head"), notes: v("dq_notes") };
    if (dept === "Operations") { out.dailySailings = v("dq_sail"); out.peakMonths = v("dq_peak"); }
    if (dept === "Fleet") { out.vesselsSoon = v("dq_vessels"); out.vesselTypes = v("dq_types"); }
    if (dept === "HR") { out.attendance = v("dq_att"); }
    if (dept === "Finance") { out.invoicePrefix = v("dq_inv"); }
    if (dept === "Maintenance") { out.workModel = v("dq_model"); }
    if (dept === "IT") { out.devices = v("dq_dev"); }
    if (dept === "Passenger Services") { out.desks = v("dq_desk"); }
    var prev = state.deptDetails[dept] || {};
    Object.keys(prev).forEach(function (k) { if (out[k] === undefined) out[k] = prev[k]; });
    return out;
  }

  function fillDeptQuestions(dept) {
    var d = state.deptDetails[dept] || {};
    function set(id, val) {
      var el = document.getElementById(id);
      if (el && val != null && val !== "") el.value = val;
    }
    set("dq_head", d.headcount); set("dq_notes", d.notes);
    set("dq_sail", d.dailySailings); set("dq_peak", d.peakMonths);
    set("dq_vessels", d.vesselsSoon); set("dq_types", d.vesselTypes);
    set("dq_att", d.attendance);
    set("dq_inv", d.invoicePrefix); set("dq_model", d.workModel);
    set("dq_dev", d.devices); set("dq_desk", d.desks);
  }

  function renderDeptDetail() {
    var depts = state.selectedDepts;
    if (!depts.length) {
      goPayroll();
      return;
    }
    if (state.deptPhaseIdx >= depts.length) {
      goPayroll();
      return;
    }
    var dept = depts[state.deptPhaseIdx];
    var n = state.deptPhaseIdx + 1;
    els.main.innerHTML =
      '<div class="ob-card">' +
      "<h1>" + esc(dept) + "</h1>" +
      '<p class="lead">Quick details for this department (' + n + " of " + depts.length + "). Skip any field you do not know yet.</p>" +
      '<div class="ob-grid">' + deptQuestions(dept) + "</div></div>";
    fillDeptQuestions(dept);
    els.back.hidden = false;
    els.skip.hidden = false;
    els.skip.textContent = "Skip department";
    els.next.textContent = n === depts.length ? "Finish setup" : "Next department";
    els.foot.hidden = false;
  }

  function saveDeptDetail(andAdvance) {
    var dept = state.selectedDepts[state.deptPhaseIdx];
    if (dept) state.deptDetails[dept] = readDeptQuestions(dept);
    var nextIdx = andAdvance ? state.deptPhaseIdx + 1 : state.deptPhaseIdx;
    state.deptPhaseIdx = nextIdx;
    return persistProgress({ phase: nextIdx >= state.selectedDepts.length ? 4 : 3, deptPhaseIdx: nextIdx, deptDetails: state.deptDetails }).then(function () {
      if (nextIdx >= state.selectedDepts.length) {
        state.phase = 4;
        renderAll();
        return;
      }
      renderAll();
    });
  }

  /* ---------- Phase 5: payroll (feeds Payroll settings and the debit instruction letter) ---------- */
  function payrollCfg() {
    var s = state.company.settings && state.company.settings["8_payroll_configuration"];
    return s && typeof s === "object" && !Array.isArray(s) ? s : {};
  }
  function seedCycle() {
    var cfg = payrollCfg();
    if (PAY_CYCLES.indexOf(cfg.cycle) > -1) return cfg.cycle;
    var hr = (state.deptDetails.HR || {}).payCycle || "";
    if (hr === "Bi-weekly" || hr === "Fortnightly") return "Fortnightly";
    if (hr === "Weekly") return "Weekly";
    return "Monthly";
  }
  function goPayroll() {
    state.phase = 4;
    return persistProgress({ phase: 4 }).then(function () { renderAll(); });
  }
  function renderPayroll() {
    var cfg = payrollCfg();
    var cycle = seedCycle();
    var fromDay = PAY_DAYS.indexOf(String(cfg.fromDay || "1")) > -1 ? String(cfg.fromDay) : "1";
    var toDay = PAY_ENDS.indexOf(String(cfg.toDay || "End of the month")) > -1 ? String(cfg.toDay) : "End of the month";
    var banks = MV_BANKS.slice();
    var bank = cfg.salaryBank || "Bank of Maldives";
    if (banks.indexOf(bank) < 0) banks.push(bank);
    els.main.innerHTML =
      '<div class="ob-card">' +
      "<h1>How you pay salaries</h1>" +
      '<p class="lead">This is written into Payroll settings. The salary debit letter uses the bank, the company account, and you as the person who signs. Each person’s salary account is added when you onboard them.</p>' +
      '<div class="ob-grid">' +
      '<div class="ob-fld"><label for="ob_cycle">Pay cycle</label><select id="ob_cycle">' + opts(PAY_CYCLES, cycle) + "</select></div>" +
      '<div class="ob-fld"><label for="ob_bank">Bank that pays salaries</label><select id="ob_bank">' + opts(banks, bank) + "</select></div>" +
      '<div class="ob-fld" id="obFromWrap"><label for="ob_from">Period starts on day</label><select id="ob_from">' + opts(PAY_DAYS, fromDay) + "</select></div>" +
      '<div class="ob-fld" id="obToWrap"><label for="ob_to">Period ends on day</label><select id="ob_to">' + opts(PAY_ENDS, toDay) + "</select></div>" +
      '<p class="ob-note" id="obPayHint">On a monthly cycle, the 1st to the end of the month is a calendar month. 16 to 15 starts on the 16th and ends on the 15th of the next month.</p>' +
      '<div class="ob-fld"><label for="ob_acct">Company account to debit</label><input id="ob_acct" inputmode="numeric" maxlength="34" placeholder="13 digits for Bank of Maldives" value="' + esc(cfg.salaryAccount || "") + '"></div>' +
      '<p class="ob-note">Leave the account blank if you do not have it yet. You can add it later under HR → Employees → Settings → Payroll.</p>' +
      "</div></div>";
    function syncPayFields() {
      var monthly = document.getElementById("ob_cycle").value === "Monthly";
      document.getElementById("obFromWrap").hidden = !monthly;
      document.getElementById("obToWrap").hidden = !monthly;
      document.getElementById("obPayHint").hidden = !monthly;
    }
    document.getElementById("ob_cycle").addEventListener("change", syncPayFields);
    syncPayFields();
    els.back.hidden = false;
    els.skip.hidden = false;
    els.skip.textContent = "Skip for now";
    els.next.textContent = "Finish setup";
    els.foot.hidden = false;
  }
  function readPayroll() {
    var cycle = document.getElementById("ob_cycle").value;
    var bank = document.getElementById("ob_bank").value;
    var account = document.getElementById("ob_acct").value.replace(/\s+/g, "");
    if (account && !/^[A-Za-z0-9]{4,34}$/.test(account)) throw new Error("The company account should be letters or digits, with no spaces.");
    if (account && bank === "Bank of Maldives" && !/^\d{13}$/.test(account)) throw new Error("A Bank of Maldives account number is 13 digits.");
    var prev = payrollCfg();
    return {
      cycle: cycle,
      fromDay: cycle === "Monthly" ? document.getElementById("ob_from").value : (prev.fromDay || "1"),
      toDay: cycle === "Monthly" ? document.getElementById("ob_to").value : (prev.toDay || "End of the month"),
      salaryBank: bank,
      salaryAccount: account
    };
  }
  function savePayrollPhase() {
    var patch = readPayroll();
    var cfg = Object.assign({}, payrollCfg(), patch);
    var tasks = [saveSetting("8_payroll_configuration", cfg)];
    var ap = Object.assign({}, (state.company.settings && state.company.settings["8_approvers_and_responsibilities"]) || {});
    var duties = Object.assign({}, ap.duties || {});
    var pay = duties.payroll || {};
    if (state.userId && !(pay.people && pay.people.length) && !pay.backup) {
      duties.payroll = { people: [state.userId], backup: null };
      ap.duties = duties;
      tasks.push(saveSetting("8_approvers_and_responsibilities", ap));
    }
    return Promise.all(tasks).then(function () { return finishWizard(); });
  }

  function finishWizard() {
    /* Cursor 2026-10-24: always persist done:true so dashboard banner clears. */
    var blob = wizardBlob();
    blob.done = true;
    blob.phase = 5;
    blob.finishedAt = new Date().toISOString();
    state.company.settings = state.company.settings || {};
    state.company.settings[WIZARD_KEY] = blob;
    return saveSetting(WIZARD_KEY, blob).then(function () {
      toast("Setup complete — opening vessels…", "ok");
      try { localStorage.setItem(VIEW_KEY, state.company.id); } catch (e) {}
      setTimeout(function () { location.replace("fleet.html"); }, 500);
    });
  }

  /* ---------- navigation ---------- */
  function renderAll() {
    renderProgress();
    if (state.phase === 0) renderCompany();
    else if (state.phase === 1) renderOrg();
    else if (state.phase === 2) renderAccess();
    else if (state.phase === 3) renderDeptDetail();
    else renderPayroll();
  }

  function withBusy(fn) {
    if (state.busy) return;
    state.busy = true;
    els.next.disabled = true;
    Promise.resolve().then(fn).catch(function (e) {
      toast(e.message || String(e), "err");
    }).then(function () {
      state.busy = false;
      els.next.disabled = false;
    });
  }

  els.next.addEventListener("click", function () {
    withBusy(function () {
      if (state.phase === 0) {
        return saveCompanyPhase().then(function () { state.phase = 1; renderAll(); });
      }
      if (state.phase === 1) {
        return saveOrgPhase().then(function () { state.phase = 2; renderAll(); });
      }
      if (state.phase === 2) {
        return saveAccessPhase().then(function () { state.phase = 3; state.deptPhaseIdx = 0; renderAll(); });
      }
      if (state.phase === 3) return saveDeptDetail(true);
      return savePayrollPhase();
    });
  });

  els.back.addEventListener("click", function () {
    if (state.busy) return;
    if (state.phase === 4) {
      if (state.selectedDepts.length) {
        state.phase = 3;
        state.deptPhaseIdx = state.selectedDepts.length - 1;
      } else {
        state.phase = 1;
      }
      renderAll();
      return;
    }
    if (state.phase === 3 && state.deptPhaseIdx > 0) {
      var dept = state.selectedDepts[state.deptPhaseIdx];
      if (dept && document.getElementById("dq_head")) state.deptDetails[dept] = readDeptQuestions(dept);
      state.deptPhaseIdx -= 1;
      renderAll();
      return;
    }
    if (state.phase > 0) {
      state.phase -= 1;
      if (state.phase === 3) state.deptPhaseIdx = Math.max(0, state.selectedDepts.length - 1);
      renderAll();
    }
  });

  els.skip.addEventListener("click", function () {
    withBusy(function () {
      if (state.phase === 1) {
        return saveOrgPhase(true).then(function () {
          if (!state.selectedDepts.length) return goPayroll();
          state.phase = 2;
          renderAll();
        });
      }
      if (state.phase === 2) {
        state.selectedDepts.forEach(function (d) {
          state.deptModules[d] = modulesForDept(d);
        });
        return saveAccessPhase().then(function () {
          if (!state.selectedDepts.length) return goPayroll();
          state.phase = 3;
          state.deptPhaseIdx = 0;
          renderAll();
        });
      }
      if (state.phase === 3) {
        var dept = state.selectedDepts[state.deptPhaseIdx];
        if (dept) state.deptDetails[dept] = state.deptDetails[dept] || {};
        return saveDeptDetail(true);
      }
      if (state.phase === 4) return finishWizard();
    });
  });

  function restoreFromSettings(c) {
    var w = (c.settings && c.settings[WIZARD_KEY]) || {};
    if (w.done === true || w.done === "true" || w.done === 1 || Number(w.phase) >= 5) {
      location.replace("fleet.html");
      return true;
    }
    if (Array.isArray(w.selectedDepts) && w.selectedDepts.length) state.selectedDepts = w.selectedDepts;
    if (w.selectedTitles && typeof w.selectedTitles === "object") state.selectedTitles = w.selectedTitles;
    if (w.deptModules && typeof w.deptModules === "object") state.deptModules = w.deptModules;
    else if (c.settings && c.settings[DEPT_MOD_KEY]) state.deptModules = c.settings[DEPT_MOD_KEY];
    if (w.deptDetails && typeof w.deptDetails === "object") state.deptDetails = w.deptDetails;
    state.phase = Math.min(4, Math.max(0, Number(w.phase) || 0));
    state.deptPhaseIdx = Math.max(0, Number(w.deptPhaseIdx) || 0);
    return false;
  }

  /* Cursor 2026-10-24: mark wizard started so dashboard can offer Finish setup if they leave. */
  function markWizardStarted() {
    var cur = (state.company.settings && state.company.settings[WIZARD_KEY]) || {};
    if (cur.done || cur.started) return Promise.resolve();
    return persistProgress({ started: true, startedAt: new Date().toISOString() });
  }

  db.auth.getSession().then(function (r) {
    if (!r.data.session) { location.replace("index.html"); return; }
    var me = r.data.session.user.id;
    state.userId = me;
    return db.from("company_members").select("role, companies(*)").eq("user_id", me).eq("active", true)
      .order("created_at", { ascending: true }).then(function (m) {
        if (m.error) throw new Error(m.error.message);
        if (!m.data.length) {
          els.main.innerHTML = '<div class="ob-card"><h1>No company yet</h1><p class="lead">Create a company first.</p><p><a href="index.html">Create company</a></p></div>';
          return;
        }
        var row = m.data[0];
        var stored = null;
        try { stored = localStorage.getItem(VIEW_KEY); } catch (e) {}
        if (stored) {
          var hit = m.data.filter(function (x) { return x.companies && x.companies.id === stored; })[0];
          if (hit) row = hit;
        }
        if (row.role !== "owner" && row.role !== "admin") {
          location.replace("dashboard.html");
          return;
        }
        state.company = row.companies;
        state.role = row.role;
        state.company.settings = state.company.settings || {};
        els.companyName.textContent = state.company.name || "Company setup";
        try { localStorage.setItem(VIEW_KEY, state.company.id); } catch (e) {}
        if (restoreFromSettings(state.company)) return;
        markWizardStarted().catch(function () {}).then(function () { renderAll(); });
      });
  }).catch(function (e) {
    els.main.innerHTML = '<div class="ob-card"><h1>Could not load</h1><p class="lead">' + esc(e.message) + "</p></div>";
  });
})();
