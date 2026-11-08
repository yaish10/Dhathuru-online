/* Cursor 2026-10-23: Add New Employee wizard (mock layout).
   Creates a company_invites row + stores a pending profile draft for Claude to apply on accept.
   Cursor 2026-10-26: same wizard edits an existing employee when api.edit is set.
   Cursor 2026-10-23: fullscreen shell — uses full viewport.
   Cursor 2026-10-23: seed / refresh departments + job_titles for employment dropdowns.
   Cursor 2026-10-23: removed Work Location field.
   Cursor 2026-10-23: modern dynamic UI — progress, chips, completion ring, motion.
   Cursor 2026-10-24: Staff login ID = company code + employee no (matches Claude 0053 staff-login). */
(function () {
  var STEPS = [
    { id: "personal", title: "Personal Information", sub: "Basic details and contact" },
    { id: "employment", title: "Employment Details", sub: "Designation, department, allowances" },
    { id: "work", title: "Work & Attendance", sub: "Shift, roster, and work info" },
    { id: "docs", title: "Qualifications & Documents", sub: "Licenses, certificates, and files" },
    { id: "extra", title: "Emergency & Additional", sub: "Emergency contacts and salary account" }
  ];
  var DAYS = [["mon", "Mon"], ["tue", "Tue"], ["wed", "Wed"], ["thu", "Thu"], ["fri", "Fri"], ["sat", "Sat"], ["sun", "Sun"]];
  var DOC_TYPES = [
    ["national_id", "National ID"],
    ["passport", "Passport"],
    ["seaman_book", "Seaman Book"],
    ["medical", "Medical Certificate"],
    ["qualifications", "Qualifications"],
    ["contract", "Contract"],
    ["other", "Other Documents"]
  ];
  var GENDERS = ["Male", "Female", "Other", "Prefer not to say"];
  var ID_KINDS = ["National ID", "Passport", "Work permit"];
  var PROBATION = [["0", "None"], ["1", "1 month"], ["2", "2 months"], ["3", "3 months"], ["6", "6 months"]];
  var ATT_METHODS = ["Bio-metric", "PIN / password", "Mobile app", "Manual"];
  /* Banks licensed to operate in the Maldives (MMA), including Maldives Premier Bank (May 2026). */
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

  function blankDraft() {
    return {
      step: 0,
      photoData: "",
      firstName: "", lastName: "", preferredName: "", empNo: "", dob: "", gender: "Male",
      phoneCode: "+960", phone: "", email: "", idKind: "National ID", idNumber: "",
      address: "", currentAddress: "",
      departmentId: "", titleId: "", employmentType: "Permanent", staffCategory: "Crew",
      startDate: "", probationMonths: "3", managerId: "",
      shift: "", roster: "Default Crew Roster", attendanceMethod: "Bio-metric",
      workDays: { mon: true, tue: true, wed: true, thu: true, fri: true, sat: false, sun: false },
      notes: "",
      docs: {},
      emergencyName: "", emergencyRelation: "", emergencyPhone: "",
      bloodGroup: "", nationality: "Maldivian",
      bankName: "", accountName: "", accountNumber: "",
      allowanceIds: [],
      role: "staff",
      sendWelcome: true, createAccount: true, addToRoster: true
    };
  }

  window.VeyoraOpenAddEmployee = function (api) {
    var esc = api.esc, $ = api.$, db = api.db, company = api.company, model = api.model;
    var openModal = api.openModal, closeModal = api.closeModal, say = api.say, options = api.options, rpc = api.rpc, icon = api.icon, I = api.I;
    var editing = api.edit || null;
    var canHr = !api.ctx || api.ctx.canHr !== false;
    var draft = blankDraft();
    if (editing) fillFromStaff(editing);
    else {
      draft.startDate = api.todayIso ? api.todayIso() : new Date().toISOString().slice(0, 10);
      draft.empNo = suggestEmpNo();
      if (!draft.employmentType || empTypes().indexOf(draft.employmentType) < 0) {
        var ets = empTypes();
        draft.employmentType = ets[0] || "Permanent";
      }
      if (!draft.staffCategory || staffCats().indexOf(draft.staffCategory) < 0) {
        var sc = staffCats();
        draft.staffCategory = sc.indexOf("Crew") >= 0 ? "Crew" : (sc[0] || "Crew");
      }
    }
    function fillFromStaff(s) {
      var meta = s.hrMeta || {};
      var named = !!s.named;
      var parts = named ? String(s.name || "").trim().split(/\s+/) : [];
      draft.firstName = parts[0] || "";
      draft.lastName = parts.slice(1).join(" ");
      draft.preferredName = meta.preferred_name || "";
      draft.empNo = s.empNo || "";
      draft.email = s.email || "";
      draft.dob = meta.dob || "";
      draft.gender = meta.gender || "Male";
      var phone = String(s.phone || "").trim();
      var codes = ["+960", "+971", "+94", "+91", "+1"];
      var hit = codes.filter(function (c) { return phone.indexOf(c) === 0; })[0];
      if (hit) { draft.phoneCode = hit; draft.phone = phone.slice(hit.length).trim(); }
      else draft.phone = phone;
      draft.idKind = meta.id_kind || "National ID";
      draft.idNumber = meta.id_number || "";
      draft.address = meta.address || "";
      draft.currentAddress = meta.current_address || "";
      draft.titleId = s.titleId || "";
      draft.departmentId = deptIdForTitle(draft.titleId) || s.deptId || "";
      draft.employmentType = s.employment || draft.employmentType;
      /* A saved person with no category stays uncategorised. Crew is only the default for a new employee. */
      draft.staffCategory = s.category || "";
      draft.startDate = s.start || "";
      draft.managerId = s.managerId || "";
      draft.role = s.role || "staff";
      draft.shift = meta.shift || "";
      draft.roster = meta.roster || draft.roster;
      draft.attendanceMethod = meta.attendance_method || draft.attendanceMethod;
      if (meta.work_days && typeof meta.work_days === "object") draft.workDays = Object.assign({}, draft.workDays, meta.work_days);
      draft.notes = meta.notes || "";
      draft.docs = meta.docs_checklist && typeof meta.docs_checklist === "object" ? meta.docs_checklist : {};
      var em = String(s.emergency || "");
      var emParts = em.split(" · ");
      if (emParts.length >= 2) {
        draft.emergencyName = emParts[0] || "";
        draft.emergencyRelation = emParts[1] || "";
        draft.emergencyPhone = emParts.slice(2).join(" · ");
      } else draft.emergencyName = em;
      draft.nationality = meta.nationality || draft.nationality;
      draft.bloodGroup = meta.blood_group || "";
      draft.bankName = s.bankName || meta.bank_name || "";
      draft.accountName = s.accountName || meta.account_name || "";
      draft.accountNumber = s.accountNumber || meta.account_number || "";
      draft.allowanceIds = allowanceIdsFrom(s.allowances || (s.draft && s.draft.allowances) || []);
      draft.probationMonths = "0";
      if (s.start && s.probationEnd) {
        var a = new Date(s.start + "T00:00:00"), b = new Date(s.probationEnd + "T00:00:00");
        var months = (b.getFullYear() - a.getFullYear()) * 12 + (b.getMonth() - a.getMonth());
        var opts = [0, 1, 2, 3, 6];
        draft.probationMonths = String(opts.reduce(function (best, n) {
          return Math.abs(n - months) < Math.abs(Number(best) - months) ? n : best;
        }, 0));
      }
      draft.sendWelcome = false;
      draft.createAccount = false;
      draft.addToRoster = false;
    }
    var first = true;
    var orgBusy = false;

    function staffCats() { return api.staffCats ? api.staffCats() : ["Crew"]; }
    function defNames(title) {
      var spec = window.VEYORA_DEFS && window.VEYORA_DEFS[title];
      if (!spec) return [];
      var base = spec.base || spec;
      var def = base.def || [];
      return def.map(function (r) { return typeof r === "string" ? r : (r && (r.name || r.title)); }).filter(Boolean);
    }
    function refreshOrgLists() {
      return Promise.all([
        db.from("departments").select("id, name, active").eq("company_id", company.id).order("name"),
        db.from("job_titles").select("id, title, department_id, active").eq("company_id", company.id).order("title")
      ]).then(function (r) {
        if (r[0].error) throw new Error(r[0].error.message);
        if (r[1].error) throw new Error(r[1].error.message);
        model.depts = (r[0].data || []).filter(function (d) { return d.active !== false; });
        model.titles = (r[1].data || []).filter(function (t) { return t.active !== false; });
        return { depts: model.depts, titles: model.titles };
      });
    }
    function seedOrgIfEmpty() {
      return refreshOrgLists().then(function (lists) {
        var jobs = [];
        if (!lists.depts.length) {
          var deptNames = defNames("Department Management");
          if (!deptNames.length) deptNames = ["Operations", "Fleet", "Passenger Services", "HR", "IT", "Finance", "Maintenance"];
          jobs.push(db.from("departments").insert(deptNames.map(function (n) {
            return { company_id: company.id, name: n };
          })).then(function (res) {
            /* Admin-only insert; ignore if HR cannot seed — they can still use +. */
            if (res.error) console.warn("seed departments:", res.error.message);
          }));
        }
        if (!lists.titles.length) {
          var titleNames = defNames("Job Titles & Positions");
          if (!titleNames.length) {
            titleNames = ["General Manager", "Operations Manager", "Dispatcher", "Captain", "First Mate", "Deckhand", "Engineer", "Ticketing Officer", "Accountant", "HR Officer"];
          }
          jobs.push(db.from("job_titles").insert(titleNames.map(function (n) {
            return { company_id: company.id, title: n };
          })).then(function (res) {
            if (res.error) console.warn("seed job_titles:", res.error.message);
          }));
        }
        if (!jobs.length) return lists;
        return Promise.all(jobs).then(function () { return refreshOrgLists(); });
      });
    }
    function addDepartment(name) {
      name = String(name || "").trim();
      if (!name) return Promise.reject(new Error("Enter a department name."));
      var exists = (model.depts || []).filter(function (d) { return d.name.toLowerCase() === name.toLowerCase(); })[0];
      if (exists) { draft.departmentId = exists.id; return Promise.resolve(exists); }
      return db.from("departments").insert({ company_id: company.id, name: name }).select("id, name, active").single()
        .then(function (r) {
          if (r.error) throw new Error(r.error.message);
          model.depts = (model.depts || []).concat([r.data]).sort(function (a, b) { return a.name.localeCompare(b.name); });
          draft.departmentId = r.data.id;
          return r.data;
        });
    }
    function addDesignation(name) {
      name = String(name || "").trim();
      if (!name) return Promise.reject(new Error("Enter a designation."));
      var exists = (model.titles || []).filter(function (t) { return t.title.toLowerCase() === name.toLowerCase(); })[0];
      if (exists) { draft.titleId = exists.id; return Promise.resolve(exists); }
      return db.from("job_titles").insert({ company_id: company.id, title: name }).select("id, title, department_id, active").single()
        .then(function (r) {
          if (r.error) throw new Error(r.error.message);
          model.titles = (model.titles || []).concat([r.data]).sort(function (a, b) { return a.title.localeCompare(b.title); });
          draft.titleId = r.data.id;
          return r.data;
        });
    }
    function empTypes() {
      var t = api.empTypes ? api.empTypes() : [];
      /* Mock uses Permanent; company list may say Full-time — keep both. */
      var extra = ["Permanent", "Temporary"];
      extra.forEach(function (x) { if (t.indexOf(x) < 0) t = t.concat([x]); });
      return t.length ? t : ["Permanent", "Full-time", "Contract"];
    }
    function shifts() {
      var rows = api.shiftDefs ? api.shiftDefs() : [];
      if (!rows.length) return [["Day", "Day Shift 07:00 – 15:00"], ["Evening", "Evening Shift 15:00 – 23:00"], ["Night", "Night Shift 23:00 – 07:00"]];
      return rows.map(function (r) {
        var code = r.code || r.name || "Shift";
        var label = (r.name || code) + (r.start && r.end ? " " + r.start + " – " + r.end : "");
        return [code, label];
      });
    }
    /* Cursor 2026-10-24: Staff ID = HR prefix + 4 digits (e.g. vy-1000). Prefix from Settings → Employee ID Format. */
    function empIdFmt() {
      return api.formSetting ? api.formSetting("2_employee_id_format", "Employee ID Format") : {};
    }
    function staffPrefix() {
      var fmt = empIdFmt();
      var raw = String(fmt.prefix != null && String(fmt.prefix).trim() ? fmt.prefix : ((company && company.code) || "vy")).trim();
      var p = raw.replace(/[^a-zA-Z0-9]/g, "");
      return (p || "vy").toLowerCase();
    }
    function pad4(n) {
      var s = String(Math.max(0, Number(n) || 0));
      while (s.length < 4) s = "0" + s;
      return s.slice(-4);
    }
    function nextStaffSeq() {
      var fmt = empIdFmt();
      var start = Math.max(1000, Number(fmt.start) || 1000);
      var max = start - 1;
      (model.staff || []).forEach(function (s) {
        var m = String(s.empNo || "").match(/(\d+)\s*$/);
        if (m) max = Math.max(max, Number(m[1]));
      });
      /* Pending invites also hold employee numbers. */
      var pending = (company.settings && company.settings["8_pending_employee_invites"]) || [];
      if (Array.isArray(pending)) {
        pending.forEach(function (item) {
          var no = item && item.profile && item.profile.employee_no;
          var m = String(no || "").match(/(\d+)\s*$/);
          if (m) max = Math.max(max, Number(m[1]));
        });
      }
      return max + 1;
    }
    function suggestEmpNo() {
      return staffPrefix() + "-" + pad4(nextStaffSeq());
    }
    function staffLoginId(empNo) {
      var raw = String(empNo != null ? empNo : draft.empNo || "").trim();
      if (!raw) return "";
      if (/^[a-z0-9]+-\d{4}$/i.test(raw)) return raw.toLowerCase();
      /* Keep an older employee number (EMP-2026-000001) until someone types a new 4-digit id. */
      if (editing && editing.empNo && raw === String(editing.empNo).trim()) return raw;
      if (/^\d+$/.test(raw)) return staffPrefix() + "-" + pad4(raw);
      var m = raw.match(/(\d+)\s*$/);
      if (m) return staffPrefix() + "-" + pad4(m[1]);
      return (staffPrefix() + "-" + raw).toLowerCase();
    }
    function shownStaffDigits() {
      var raw = String(draft.empNo || "");
      if (/^[a-z0-9]+-\d{4}$/i.test(raw)) return (raw.match(/(\d{4})$/) || ["", ""])[1];
      return "";
    }
    function staffIdCardHtml() {
      var id = staffLoginId();
      var prefix = staffPrefix();
      return '<div class="ne-staffid' + (id ? " ready" : "") + '" id="neStaffIdCard">' +
        '<div class="ne-staffid-lab"><strong>Staff login ID</strong>' +
        '<small>Format <em>' + esc(prefix) + "-1000</em> · prefix set in HR Settings → Employee ID Format · they sign in with this or email</small></div>" +
        '<div class="ne-staffid-row">' +
          '<code id="neStaffIdVal">' + (id ? esc(id) : esc(prefix) + "-…") + "</code>" +
          '<button type="button" class="ne-icon-btn" id="neStaffIdCopy" title="Copy staff ID" aria-label="Copy staff ID"' +
            (id ? "" : " disabled") + ">" +
            icon('<path d="M8 8h10v12H8zM6 16H4V4h12v2"/>') + "</button></div></div>";
    }
    function syncStaffIdCard() {
      var card = $("neStaffIdCard");
      if (!card) return;
      var id = staffLoginId();
      var prefix = staffPrefix();
      card.classList.toggle("ready", !!id);
      var val = $("neStaffIdVal");
      if (val) val.textContent = id || (prefix + "-…");
      var btn = $("neStaffIdCopy");
      if (btn) btn.disabled = !id;
    }
    function fullName() {
      return [draft.firstName, draft.lastName].filter(Boolean).join(" ").trim() || (editing && editing.named ? editing.name : "") || "New employee";
    }
    function titleById(id) {
      return (model.titles || []).filter(function (x) { return x.id === id; })[0];
    }
    function deptIdForTitle(id) {
      var t = titleById(id);
      return t && t.department_id ? t.department_id : "";
    }
    function normAlw(s) { return String(s || "").trim().toLowerCase(); }
    function allowanceCatalog() {
      var raw = company.settings && company.settings["8_allowance_catalog"];
      return Array.isArray(raw) ? raw.filter(function (a) { return a && a.id && a.name && a.active !== false; }) : [];
    }
    function allowanceIdsFrom(list) {
      return (list || []).map(function (a) {
        var hit = allowanceCatalog().filter(function (c) { return normAlw(c.name) === normAlw(a && a.name); })[0];
        return hit ? hit.id : "";
      }).filter(Boolean);
    }
    function chosenAllowances() {
      return (draft.allowanceIds || []).map(function (id) {
        var a = allowanceCatalog().filter(function (c) { return c.id === id; })[0];
        return a ? { name: a.name, amount: Math.round((Number(a.amount) || 0) * 100) / 100 } : null;
      }).filter(Boolean);
    }
    function alwMoney(n) {
      return "MVR " + Number(n || 0).toLocaleString("en-US", { minimumFractionDigits: 2, maximumFractionDigits: 2 });
    }
    function allowanceField() {
      var cat = allowanceCatalog();
      var picked = draft.allowanceIds || [];
      var chips = picked.map(function (id) {
        var a = cat.filter(function (x) { return x.id === id; })[0];
        if (!a) return "";
        return '<button type="button" class="alw-chip" data-alw-off="' + esc(id) + '">' + esc(a.name) + " · " + esc(alwMoney(a.amount)) + " <span aria-hidden=\"true\">×</span></button>";
      }).join("");
      var left = cat.filter(function (a) { return picked.indexOf(a.id) < 0; });
      return fld("neAllow", "Allowances",
        '<div class="alw-pick">' +
          (chips ? '<div class="alw-chips">' + chips + "</div>" : "") +
          '<select id="neAllow" aria-label="Allowances">' +
            '<option value="">' + (cat.length ? (left.length ? "Add an allowance" : "All allowances added") : "No allowances yet") + "</option>" +
            left.map(function (a) { return '<option value="' + esc(a.id) + '">' + esc(a.name) + " · " + esc(alwMoney(a.amount)) + "</option>"; }).join("") +
          "</select></div>" +
        '<small class="ne-hint">Monthly amounts from <a href="hr.html#allowances">Allowances</a>. They are paid with salary.</small>',
        true);
    }
    function saveMemberAllowances(uid) {
      var names = {};
      allowanceCatalog().forEach(function (a) { names[normAlw(a.name)] = true; });
      var kept = (editing.allowances || []).filter(function (a) { return a && a.name && !names[normAlw(a.name)]; }).map(function (a) {
        return { name: a.name, amount: Number(a.amount) || 0 };
      });
      var next = kept.concat(chosenAllowances());
      if (!editing.hasPay && !next.length) return Promise.resolve();
      return rpc("set_member_pay", {
        p_company: company.id,
        p_user: uid,
        p_basic: Number(editing.basic) || 0,
        p_allowances: next,
        p_pension: editing.pension !== false,
        p_method: editing.payMethod || "Bank transfer"
      });
    }
    function titleName() {
      var t = titleById(draft.titleId);
      return t ? t.title : "";
    }
    function deptName() {
      var d = (model.depts || []).filter(function (x) { return x.id === draft.departmentId; })[0];
      return d ? d.name : "";
    }
    function mgrName() {
      var m = (model.staff || []).filter(function (x) { return x.uid === draft.managerId; })[0];
      return m ? m.name : "";
    }
    function req(label) { return esc(label) + ' <span class="ne-req">*</span>'; }
    function fld(id, label, inputHtml, full) {
      return '<div class="ne-fld' + (full ? " full" : "") + '"><label for="' + id + '">' + label + "</label>" + inputHtml + "</div>";
    }
    function inp(id, key, opts) {
      opts = opts || {};
      return '<input id="' + id + '" data-k="' + key + '"' +
        (opts.type ? ' type="' + opts.type + '"' : "") +
        (opts.max != null ? ' maxlength="' + opts.max + '"' : "") +
        (opts.ph ? ' placeholder="' + esc(opts.ph) + '"' : "") +
        (opts.ro ? " readonly" : "") +
        ' value="' + esc(draft[key] || "") + '">';
    }
    function sel(id, key, list, blank, extra) {
      return '<select id="' + id + '" data-k="' + key + '"' + (extra || "") + '>' + options(list, draft[key] || "", blank) + "</select>";
    }
    /* Cursor 2026-10-23: pill / segment pickers for a more dynamic feel than plain selects. */
    function chips(key, list, cls) {
      cls = cls || "ne-chips";
      return '<div class="' + cls + '" data-chip-key="' + key + '" role="group">' + list.map(function (item) {
        var v = typeof item === "string" ? item : item[0];
        var lab = typeof item === "string" ? item : item[1];
        var on = String(draft[key] || "") === String(v);
        return '<button type="button" class="ne-chip' + (on ? " on" : "") + '" data-chip-val="' + esc(v) + '">' + esc(lab) + "</button>";
      }).join("") + "</div>";
    }
    function completionPct() {
      var score = 0, total = 12;
      if (draft.firstName.trim()) score++;
      if (draft.lastName.trim()) score++;
      if (draft.email.trim()) score++;
      if (draft.empNo) score++;
      if (draft.phone) score++;
      if (draft.departmentId) score++;
      if (draft.titleId) score++;
      if (draft.startDate) score++;
      if (draft.shift) score++;
      if (draft.emergencyName || draft.emergencyPhone) score++;
      if (Object.keys(draft.docs || {}).some(function (k) { return draft.docs[k]; })) score++;
      if (draft.photoData) score++;
      return Math.round((score / total) * 100);
    }
    function progressBarHtml() {
      var pct = Math.round(((draft.step + 1) / STEPS.length) * 100);
      var done = completionPct();
      return '<div class="ne-prog">' +
        '<div class="ne-prog-meta"><strong>Step ' + (draft.step + 1) + " of " + STEPS.length +
          " · " + esc(STEPS[draft.step].title) + "</strong><span>Profile " + done + "% complete</span></div>" +
        '<div class="ne-prog-track" role="progressbar" aria-valuenow="' + pct + '" aria-valuemin="0" aria-valuemax="100">' +
          '<div class="ne-prog-fill" style="width:' + pct + '%"></div></div></div>';
    }

    function readDom() {
      [].forEach.call(document.querySelectorAll("#modalCard [data-k]"), function (el) {
        var k = el.getAttribute("data-k");
        if (!k) return;
        if (el.type === "checkbox") draft[k] = el.checked;
        else draft[k] = el.value;
      });
      [].forEach.call(document.querySelectorAll("[data-day]"), function (b) {
        draft.workDays[b.getAttribute("data-day")] = b.classList.contains("on");
      });
      ["sendWelcome", "createAccount", "addToRoster"].forEach(function (k) {
        var sw = document.querySelector('[data-toggle="' + k + '"]');
        if (sw) draft[k] = sw.getAttribute("aria-checked") === "true";
      });
    }

    function validateStep(i) {
      if (i === 0) {
        if (!draft.firstName.trim()) return "Enter a first name.";
        if (!draft.lastName.trim()) return "Enter a last name.";
        if (!draft.email.trim() || !/^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(draft.email.trim())) return "Enter a valid work email.";
        if (!String(draft.empNo || "").trim()) return "Enter a staff number (4 digits) or use Suggest.";
        draft.empNo = staffLoginId(draft.empNo);
        var legacyKept = editing && editing.empNo && draft.empNo === String(editing.empNo).trim() && !/^[a-z0-9]+-\d{4}$/i.test(draft.empNo);
        if (!legacyKept && !/^[a-z0-9]+-\d{4}$/i.test(draft.empNo)) {
          return "Staff ID must look like " + staffPrefix() + "-1000 (prefix + 4 digits).";
        }
      }
      if (i === 1) {
        if (!draft.startDate) return "Pick a joining date.";
      }
      if (i === 4) {
        var bank = String(draft.bankName || "").trim();
        var holder = String(draft.accountName || "").trim();
        var acct = String(draft.accountNumber || "").replace(/\s+/g, "");
        draft.bankName = bank;
        draft.accountName = holder;
        draft.accountNumber = acct;
        var filled = (bank ? 1 : 0) + (holder ? 1 : 0) + (acct ? 1 : 0);
        if (filled && filled < 3) return "Choose the bank, account name, and account number together.";
        if (holder && holder.length < 2) return "Account name needs at least 2 characters.";
        if (acct && !/^[A-Za-z0-9]{4,34}$/.test(acct)) return "Account number should be 4 to 34 letters or digits.";
        if (bank && MV_BANKS.indexOf(bank) < 0 && !(editing && bank === String(editing.bankName || ""))) return "Choose a bank in the Maldives.";
      }
      if (i === 4 && draft.createAccount && !draft.email.trim()) return "Email is required to create a user account.";
      if (i === 4 && draft.createAccount) {
        draft.empNo = staffLoginId(draft.empNo);
        if (!/^[a-z0-9]+-\d{4}$/i.test(draft.empNo || "")) {
          return "Staff ID must look like " + staffPrefix() + "-1000 before creating an account.";
        }
      }
      return "";
    }

    function previewHtml() {
      var pct = completionPct();
      var r = 26, c = 2 * Math.PI * r, off = c * (1 - pct / 100);
      var av = draft.photoData
        ? '<img class="ne-av" src="' + esc(draft.photoData) + '" alt="">'
        : '<span class="ne-av ph">' + esc((draft.firstName[0] || "N") + (draft.lastName[0] || "E")).toUpperCase() + "</span>";
      var bits = [
        [I.brief || I.user, titleName() || "No designation"],
        [I.people, deptName() || "No department"],
        [I.shield, (draft.staffCategory || "—") + (draft.employmentType ? " · " + draft.employmentType : "")],
        [I.cal, draft.startDate ? "Joined " + (api.fmtDate ? api.fmtDate(draft.startDate) : draft.startDate) : "Join date —"]
      ];
      var docs = DOC_TYPES.map(function (d) {
        var on = !!draft.docs[d[0]];
        return '<li class="' + (on ? "on" : "") + '"><span class="ne-doc-ic" aria-hidden="true">' +
          (on ? icon(I.check) : "") + '</span><span class="grow"><strong>' + esc(d[1]) + '</strong><small>' +
          (on ? "Ready" : "Not added") + "</small></span></li>";
      }).join("");
      function tog(k, label) {
        return '<button type="button" class="ne-tog" data-toggle="' + k + '" role="switch" aria-checked="' + (draft[k] ? "true" : "false") + '">' +
          '<span>' + esc(label) + '</span><i></i></button>';
      }
      return '<aside class="ne-side">' +
        '<div class="ne-preview">' +
          '<div class="ne-preview-top">' +
            '<div class="ne-ring-wrap" title="Profile completeness">' +
              '<svg class="ne-ring" width="64" height="64" viewBox="0 0 64 64" aria-hidden="true">' +
                '<defs><linearGradient id="neGrad" x1="0%" y1="0%" x2="100%" y2="0%">' +
                '<stop offset="0%" stop-color="#2d9bff"/><stop offset="100%" stop-color="#7c3aed"/></linearGradient></defs>' +
                '<circle class="bg" cx="32" cy="32" r="' + r + '"/>' +
                '<circle class="fg" cx="32" cy="32" r="' + r + '" stroke="url(#neGrad)" stroke-dasharray="' + c.toFixed(1) +
                '" stroke-dashoffset="' + off.toFixed(1) + '"/></svg>' +
              '<span class="ne-ring-pct">' + pct + "%</span></div>" +
            '<div><strong>' + esc(fullName()) + '</strong>' +
            '<small>' + esc(draft.empNo || "—") + '</small>' +
            (staffLoginId() ? '<small class="ne-staffid-mini">Staff ID · ' + esc(staffLoginId()) + "</small>" : "") +
            '<span class="ne-badge">' + esc(editing ? (editing.shownStatus || "Active") : "Active") + "</span></div></div>" +
          '<div class="ne-preview-top" style="margin-top:4px">' + av +
            '<ul class="ne-meta" style="flex:1;margin:0">' + bits.slice(0, 2).map(function (b) {
              return '<li>' + icon(b[0]) + '<span>' + esc(b[1]) + "</span></li>";
            }).join("") + "</ul></div>" +
          '<ul class="ne-meta">' + bits.slice(2).map(function (b) {
            return '<li>' + icon(b[0]) + '<span>' + esc(b[1]) + "</span></li>";
          }).join("") + "</ul></div>" +
        '<div class="ne-docs"><div class="ne-docs-head"><strong>Documents</strong>' +
          '<button type="button" class="ne-add-doc" id="neDocAdd">' + icon(I.plus) + " Add</button></div>" +
          "<ul>" + docs + "</ul></div>" +
        (editing ? "" :
          '<div class="ne-quick"><strong>Quick actions</strong>' +
            tog("sendWelcome", "Send welcome email") +
            tog("createAccount", "Create user account") +
            tog("addToRoster", "Add to duty roster") +
          "</div>") +
        '<p class="msg" id="mMsg" role="status"></p>' +
      "</aside>";
    }

    function stepPersonal() {
      return '<section class="ne-block">' +
        '<header><span class="ne-ic">' + icon(I.user) + '</span><div><h3>Personal Information</h3><p>Identity and basic details</p></div></header>' +
        '<div class="ne-photo">' +
          (draft.photoData ? '<img src="' + esc(draft.photoData) + '" alt="">' : '<span class="ph">' + icon(I.user) + "</span>") +
          '<div><button type="button" class="ghost" id="nePhotoBtn">Upload Photo</button>' +
          '<small>JPG, PNG · Max 2 MB</small><input type="file" id="nePhoto" accept="image/jpeg,image/png" hidden></div></div>' +
        '<div class="ne-grid">' +
          fld("neFirst", req("First Name"), inp("neFirst", "firstName", { max: 60, ph: "Ahmed" })) +
          fld("neLast", req("Last Name"), inp("neLast", "lastName", { max: 60, ph: "Raza" })) +
          fld("neEmpNo", req("Staff ID"),
            '<div class="ne-empno ne-staff-compose">' +
              '<span class="ne-staff-prefix" title="Change prefix in HR Settings → Employee ID Format">' + esc(staffPrefix()) + "</span>" +
              '<span class="ne-staff-sep" aria-hidden="true">-</span>' +
              '<input id="neEmpDigits" maxlength="4" inputmode="numeric" pattern="[0-9]*" placeholder="1000" ' +
                'value="' + esc(shownStaffDigits()) + '" aria-label="Staff number (4 digits)">' +
              '<input id="neEmpNo" data-k="empNo" type="hidden" value="' + esc(draft.empNo || "") + '">' +
              '<button type="button" class="ne-icon-btn" id="neEmpRefresh" title="Next number" aria-label="Suggest next staff ID">' +
              icon('<path d="M4 12a8 8 0 0 1 14-4M20 12a8 8 0 0 1-14 4M20 4v5h-5M4 20v-5h5"/>') + "</button></div>" +
              '<small class="ne-hint">Prefix <strong>' + esc(staffPrefix()) + '</strong> is set in <a href="hr.html#employees/settings/ids">Employees → Settings → Staff IDs</a>. Example: ' + esc(staffPrefix()) + "-1000</small>" +
              (editing && draft.empNo && !/^[a-z0-9]+-\d{4}$/i.test(draft.empNo)
                ? '<small class="ne-hint">Current ID <strong>' + esc(draft.empNo) + "</strong> stays as it is until you type a new 4-digit number.</small>"
                : "")) +
          '<div class="ne-fld full">' + staffIdCardHtml() + "</div>" +
          fld("nePref", "Preferred Name", inp("nePref", "preferredName", { max: 60, ph: "Optional" })) +
          fld("neDob", "Date of Birth", inp("neDob", "dob", { type: "date" })) +
          fld("neGender", "Gender", chips("gender", GENDERS), true) +
        "</div></section>" +
        '<section class="ne-block">' +
        '<header><span class="ne-ic">' + icon(I.people) + '</span><div><h3>Contact Information</h3><p>How we reach them</p></div></header>' +
        '<div class="ne-grid">' +
          fld("nePhone", "Mobile Number",
            // Cursor 2026-10-23: compact native country code (skip fancy select — was dwarfing the number field).
            '<div class="ne-phone"><select id="nePhoneCode" data-k="phoneCode" data-vsel="skip" aria-label="Country code">' +
              options([["+960", "+960"], ["+971", "+971"], ["+94", "+94"], ["+91", "+91"], ["+1", "+1"]], draft.phoneCode) +
            "</select>" + inp("nePhone", "phone", { max: 30, ph: "7XXXXXX" }) + "</div>") +
          fld("neEmail", req("Email Address"), inp("neEmail", "email", { type: "email", max: 120, ph: "name@company.com", ro: !!editing }) +
            (editing ? '<small class="ne-hint">Login email stays the same. They still sign in with this address or their staff ID.</small>' : "")) +
          fld("neId", "National ID / Passport No.",
            '<div class="ne-id">' + inp("neId", "idNumber", { max: 40, ph: "A123456" }) +
            sel("neIdKind", "idKind", ID_KINDS) + "</div>") +
          fld("neAddr", "Address", inp("neAddr", "address", { max: 160, ph: "Permanent address" }), true) +
          fld("neCurr", "Current Address", inp("neCurr", "currentAddress", { max: 160, ph: "Same as above if empty" }), true) +
        "</div></section>";
    }

    function stepEmployment() {
      var mgrs = (model.staff || []).filter(function (s) { return s.active && (!editing || s.uid !== editing.uid); }).map(function (s) {
        return [s.uid, s.name + (s.position ? " · " + s.position : "")];
      });
      var typeList = empTypes().slice();
      if (draft.employmentType && typeList.indexOf(draft.employmentType) < 0) typeList.push(draft.employmentType);
      var catList = staffCats().slice();
      if (draft.staffCategory && catList.indexOf(draft.staffCategory) < 0) catList.push(draft.staffCategory);
      var catItems = catList.map(function (c) { return [c, c]; });
      if (editing) catItems.unshift(["", "None"]);
      var depts = model.depts || [];
      var titles = model.titles || [];
      var deptOpts = depts.map(function (d) { return [d.id, d.name]; });
      var titleOpts = titles.map(function (t) {
        var dn = (model.depts || []).filter(function (d) { return d.id === t.department_id; })[0];
        return [t.id, t.title + (dn ? " · " + dn.name : "")];
      });
      return '<section class="ne-block">' +
        '<header><span class="ne-ic">' + icon(I.brief) + '</span><div><h3>Employment Details</h3><p>Role in the company' +
          (orgBusy ? " · loading lists…" : "") +
          (!orgBusy && !depts.length && !titles.length ? ' · <span class="ne-warn">No org lists yet — seeding defaults…</span>' : "") +
        "</p></div></header>" +
        '<div class="ne-grid">' +
          fld("neTitle", "Designation",
            '<div class="ne-combo">' + sel("neTitle", "titleId", titleOpts, titles.length ? "Select designation" : "No designations yet") +
            '<button type="button" class="ne-add-btn" id="neTitleAdd" title="Add designation">+</button></div>' +
            (!titles.length ? '<small class="ne-hint">Add Captain, Deckhand, etc. here — or under HR → Departments &amp; Designations.</small>' : "")) +
          fld("neDept", "Department",
            '<div class="ne-combo">' + sel("neDept", "departmentId", deptOpts, depts.length ? "From the designation" : "No departments yet") +
            '<button type="button" class="ne-add-btn" id="neDeptAdd" title="Add department">+</button></div>' +
            '<small class="ne-hint">Filled from the designation. Set each designation’s department under <a href="hr.html#organization">Departments &amp; Designations</a>.</small>') +
          fld("neEmpType", "Employment Type", chips("employmentType", typeList), true) +
          fld("neCat", "Staff Category", chips("staffCategory", editing ? catItems : catList), true) +
          fld("neStart", req("Date of Joining"), inp("neStart", "startDate", { type: "date" })) +
          fld("neProb", "Probation Period", sel("neProb", "probationMonths", PROBATION)) +
          fld("neMgr", "Reporting Manager", sel("neMgr", "managerId", mgrs, "Select manager")) +
          allowanceField() +
          (editing && editing.role === "owner"
            ? fld("neRole", "System access role", '<select id="neRole" disabled><option>Owner</option></select><small class="ne-hint">The owner role stays on this account.</small>')
            : fld("neRole", "System access role", sel("neRole", "role", [
              ["staff", "Staff"], ["operations", "Operations"], ["hr", "HR"], ["it", "IT"], ["admin", "Admin"]
            ], null, (editing && !(api.ctx && (api.ctx.isAdmin || api.ctx.myRole === "owner" || api.ctx.isPlatform))) ? " disabled" : "") +
              (editing ? '<small class="ne-hint">Owners and admins can change this. Everyone else keeps the role they have.</small>' : ""))) +
        "</div></section>";
    }

    function stepWork() {
      var sh = shifts();
      if (!draft.shift && sh[0]) draft.shift = sh[0][0];
      return '<section class="ne-block">' +
        '<header><span class="ne-ic">' + icon(I.clock) + '</span><div><h3>Work &amp; Attendance</h3><p>Shift and roster defaults</p></div></header>' +
        '<div class="ne-grid">' +
          fld("neShift", "Shift", sel("neShift", "shift", sh)) +
          fld("neRoster", "Duty Roster", sel("neRoster", "roster", ["Default Crew Roster", "Shore staff roster", "Custom"])) +
          fld("neAtt", "Attendance Method", chips("attendanceMethod", ATT_METHODS), true) +
        "</div>" +
        '<div class="ne-fld full"><label>Work Days</label><div class="ne-days">' +
          DAYS.map(function (d) {
            return '<button type="button" class="ne-day' + (draft.workDays[d[0]] ? " on" : "") + '" data-day="' + d[0] + '">' + d[1] + "</button>";
          }).join("") +
        "</div></div>" +
        '<div class="ne-fld full"><label for="neNotes">Notes</label><textarea id="neNotes" data-k="notes" rows="3" placeholder="e.g. work arrangement, special conditions">' +
          esc(draft.notes) + "</textarea></div></section>";
    }

    function stepDocs() {
      return '<section class="ne-block">' +
        '<header><span class="ne-ic">' + icon(I.doc) + '</span><div><h3>Qualifications &amp; Documents</h3><p>' +
          (editing ? "Mark what is already on file — upload the files from their profile" : "Mark what you already have — files upload after they join") +
          "</p></div></header>" +
        '<ul class="ne-doc-pick">' + DOC_TYPES.map(function (d) {
          var on = !!draft.docs[d[0]];
          return '<li><label class="ne-check"><input type="checkbox" data-doc="' + d[0] + '"' + (on ? " checked" : "") + "> <span><strong>" +
            esc(d[1]) + "</strong><small>" + (on ? "Ready to attach later" : "Not added yet") + "</small></span></label></li>";
        }).join("") + "</ul>" +
        '<p class="ne-hint">' + (editing
          ? "Document files stay on the employee profile (Documents tab)."
          : "Document files are stored on the employee profile after they accept the invite (staff-documents bucket).") +
        "</p></section>";
    }

    function stepExtra() {
      return '<section class="ne-block">' +
        '<header><span class="ne-ic">' + icon(I.alert) + '</span><div><h3>Emergency &amp; Additional</h3><p>Safety contacts and extras</p></div></header>' +
        '<div class="ne-grid">' +
          fld("neEmName", "Emergency contact name", inp("neEmName", "emergencyName", { max: 80, ph: "Full name" })) +
          fld("neEmRel", "Relationship", inp("neEmRel", "emergencyRelation", { max: 40, ph: "Spouse, parent…" })) +
          fld("neEmPhone", "Emergency phone", inp("neEmPhone", "emergencyPhone", { max: 40, ph: "+960 …" })) +
          fld("neNat", "Nationality", inp("neNat", "nationality", { max: 60 })) +
          fld("neBlood", "Blood group", inp("neBlood", "bloodGroup", { max: 8, ph: "O+" })) +
        "</div></section>" +
        '<section class="ne-block">' +
        '<header><span class="ne-ic">' + icon(I.brief) + '</span><div><h3>Salary account</h3><p>Where monthly pay is sent. Only HR and this person can see it.</p></div></header>' +
        '<div class="ne-grid">' +
          fld("neBank", "Bank", sel("neBank", "bankName", (function () {
            var list = MV_BANKS.slice();
            if (draft.bankName && list.indexOf(draft.bankName) < 0) list.push(draft.bankName);
            return list;
          })(), "Select bank")) +
          fld("neAcctName", "Account name", inp("neAcctName", "accountName", { max: 80, ph: "Name on the account" })) +
          fld("neAcctNo", "Account number", inp("neAcctNo", "accountNumber", { max: 34, ph: "7701234567890" }), true) +
        "</div></section>";
    }

    function bodyForStep() {
      return [stepPersonal, stepEmployment, stepWork, stepDocs, stepExtra][draft.step]();
    }

    function draw() {
      var keep = !first && $("modalCard") ? $("modalCard").scrollTop : 0;
      var nav = STEPS.map(function (s, i) {
        var st = i === draft.step ? " on" : (i < draft.step ? " done" : "");
        return '<button type="button" class="ne-step' + st + '" data-step="' + i + '">' +
          '<span class="ne-step-n">' + (i < draft.step ? icon(I.check) : (i + 1)) + "</span>" +
          "<span><strong>" + esc(s.title) + "</strong><small>" + esc(s.sub) + "</small></span></button>";
      }).join("");
      var html =
        '<div class="ne-wiz">' +
          '<header class="ne-top">' +
            '<div class="ne-top-l"><p class="ne-kicker"><i></i> ' + (editing ? "HR · Employee" : "HR · Onboarding") + "</p>" +
            "<h2>" + (editing ? "Edit employee" : "Add New Employee") + "</h2>" +
            '<p class="note">' + (editing
              ? (canHr
                ? "Same steps as Add New Employee. Save writes this profile onto " + esc(editing.name || "this person") + "."
                : "Same steps as Add New Employee. Saving updates your name and contact details.")
              : "Build their profile step by step — invite goes out when you finish.") + "</p></div>" +
            '<button type="button" class="ne-x" data-close aria-label="Close">×</button>' +
            progressBarHtml() +
          "</header>" +
          '<div class="ne-body">' +
            '<nav class="ne-nav" aria-label="Steps">' + nav + "</nav>" +
            '<div class="ne-main" id="neMain"><div class="ne-main-inner" id="neStepPane">' + bodyForStep() + "</div></div>" +
            previewHtml() +
          "</div>" +
          '<footer class="ne-foot">' +
            '<button type="button" class="ghost" data-close>Cancel</button>' +
            '<div class="ne-foot-r">' +
              '<button type="button" class="ghost" id="nePrev"' + (draft.step === 0 ? " disabled" : "") + ">Previous</button>" +
              (draft.step < STEPS.length - 1
                ? '<button type="button" class="save" id="neNext">Continue <span aria-hidden="true">→</span></button>'
                : '<button type="button" class="save" id="neSubmit">' + (editing ? "Save changes" : "Create invite") + "</button>") +
            "</div>" +
          "</footer>" +
        "</div>";
      if (first) { openModal(html, "xwide"); first = false; }
      else { $("modalCard").innerHTML = html; $("modalCard").scrollTop = keep; }
      bind();
      var pane = $("neStepPane");
      if (pane) { pane.style.animation = "none"; void pane.offsetWidth; pane.style.animation = ""; }
    }

    function bind() {
      [].forEach.call(document.querySelectorAll("[data-step]"), function (b) {
        b.addEventListener("click", function () {
          readDom();
          var to = Number(b.getAttribute("data-step"));
          if (to > draft.step) {
            var err = validateStep(draft.step);
            if (err) { say(err, "err"); return; }
          }
          draft.step = to; draw();
        });
      });
      if ($("nePrev")) $("nePrev").addEventListener("click", function () { readDom(); if (draft.step > 0) { draft.step--; draw(); } });
      if ($("neNext")) $("neNext").addEventListener("click", function () {
        readDom();
        var err = validateStep(draft.step);
        if (err) { say(err, "err"); return; }
        draft.step++; draw();
      });
      if ($("neSubmit")) $("neSubmit").addEventListener("click", submit);
      function applyStaffDigits(digits) {
        digits = String(digits || "").replace(/\D/g, "").slice(0, 4);
        if ($("neEmpDigits")) $("neEmpDigits").value = digits;
        draft.empNo = digits ? staffPrefix() + "-" + (digits.length === 4 ? digits : pad4(digits)) : "";
        /* While typing fewer than 4 digits, keep provisional id with padded value for preview. */
        if (digits && digits.length < 4) draft.empNo = staffPrefix() + "-" + pad4(digits);
        if (digits && digits.length === 4) draft.empNo = staffPrefix() + "-" + digits;
        if (!digits) draft.empNo = "";
        if ($("neEmpNo")) $("neEmpNo").value = draft.empNo;
        syncStaffIdCard();
        refreshPreviewSoft();
      }
      if ($("neEmpDigits")) {
        $("neEmpDigits").addEventListener("input", function () {
          applyStaffDigits($("neEmpDigits").value);
        });
        $("neEmpDigits").addEventListener("blur", function () {
          var d = String($("neEmpDigits").value || "").replace(/\D/g, "").slice(0, 4);
          if (d) applyStaffDigits(pad4(d));
        });
      }
      if ($("neEmpRefresh")) $("neEmpRefresh").addEventListener("click", function () {
        draft.empNo = suggestEmpNo();
        var dig = (String(draft.empNo).match(/(\d{4})$/) || ["", "1000"])[1];
        if ($("neEmpDigits")) $("neEmpDigits").value = dig;
        if ($("neEmpNo")) $("neEmpNo").value = draft.empNo;
        syncStaffIdCard();
        refreshPreviewSoft();
      });
      if ($("neStaffIdCopy")) $("neStaffIdCopy").addEventListener("click", function () {
        var id = staffLoginId();
        if (!id) return;
        function ok() { say("Staff ID copied.", "ok"); }
        if (navigator.clipboard && navigator.clipboard.writeText) {
          navigator.clipboard.writeText(id).then(ok).catch(function () {
            try { window.prompt("Copy staff ID", id); } catch (e) {}
          });
        } else {
          try { window.prompt("Copy staff ID", id); } catch (e) {}
        }
      });
      if ($("nePhotoBtn")) $("nePhotoBtn").addEventListener("click", function () { $("nePhoto").click(); });
      if ($("nePhoto")) $("nePhoto").addEventListener("change", function () {
        var f = $("nePhoto").files && $("nePhoto").files[0];
        if (!f) return;
        if (f.size > 2 * 1024 * 1024) { say("Photo must be under 2 MB.", "err"); return; }
        var r = new FileReader();
        r.onload = function () { draft.photoData = String(r.result || ""); draw(); };
        r.readAsDataURL(f);
      });
      [].forEach.call(document.querySelectorAll("[data-day]"), function (b) {
        b.addEventListener("click", function () {
          b.classList.toggle("on");
          draft.workDays[b.getAttribute("data-day")] = b.classList.contains("on");
          refreshPreviewSoft();
        });
      });
      /* Cursor 2026-10-23: chip / segment pickers write into draft[key]. */
      [].forEach.call(document.querySelectorAll("[data-chip-key]"), function (group) {
        var key = group.getAttribute("data-chip-key");
        [].forEach.call(group.querySelectorAll("[data-chip-val]"), function (btn) {
          btn.addEventListener("click", function () {
            draft[key] = btn.getAttribute("data-chip-val");
            [].forEach.call(group.querySelectorAll("[data-chip-val]"), function (b) {
              var on = b.getAttribute("data-chip-val") === draft[key];
              if (b.classList.contains("ne-chip")) b.classList.toggle("on", on);
              else b.classList.toggle("on", on);
            });
            refreshPreviewSoft();
          });
        });
      });
      [].forEach.call(document.querySelectorAll("[data-doc]"), function (c) {
        c.addEventListener("change", function () {
          draft.docs[c.getAttribute("data-doc")] = c.checked;
          var lab = c.closest("label");
          var small = lab && lab.querySelector("small");
          if (small) small.textContent = c.checked ? "Ready to attach later" : "Not added yet";
          refreshPreviewSoft();
        });
      });
      [].forEach.call(document.querySelectorAll("[data-toggle]"), function (b) {
        b.addEventListener("click", function () {
          var on = b.getAttribute("aria-checked") !== "true";
          b.setAttribute("aria-checked", on ? "true" : "false");
          draft[b.getAttribute("data-toggle")] = on;
        });
      });
      if ($("neDocAdd")) $("neDocAdd").addEventListener("click", function () {
        readDom(); draft.step = 3; draw();
      });
      if ($("neDeptAdd")) $("neDeptAdd").addEventListener("click", function () {
        readDom();
        var name = window.prompt("New department name", "Operations");
        if (name == null) return;
        say("Saving department…");
        addDepartment(name).then(function () { draw(); say("Department added.", "ok"); })
          .catch(function (e) { say(e.message || String(e), "err"); });
      });
      [].forEach.call(document.querySelectorAll("[data-alw-off]"), function (b) {
        b.addEventListener("click", function () {
          readDom();
          var id = b.getAttribute("data-alw-off");
          draft.allowanceIds = (draft.allowanceIds || []).filter(function (x) { return x !== id; });
          draw();
        });
      });
      if ($("neTitleAdd")) $("neTitleAdd").addEventListener("click", function () {
        readDom();
        var name = window.prompt("New designation (e.g. Captain)", "Captain");
        if (name == null) return;
        say("Saving designation…");
        addDesignation(name).then(function () { draw(); say("Designation added.", "ok"); })
          .catch(function (e) { say(e.message || String(e), "err"); });
      });
      $("modalCard").oninput = function () { readDom(); syncStaffIdCard(); refreshPreviewSoft(); };
      $("modalCard").onchange = function (ev) {
        readDom();
        if (ev && ev.target && ev.target.id === "neTitle") {
          draft.departmentId = deptIdForTitle(draft.titleId) || "";
          if ($("neDept")) $("neDept").value = draft.departmentId;
        }
        if (ev && ev.target && ev.target.id === "neAllow" && ev.target.value) {
          if ((draft.allowanceIds || []).indexOf(ev.target.value) < 0) draft.allowanceIds.push(ev.target.value);
          draw();
          return;
        }
        syncStaffIdCard();
        refreshPreviewSoft();
      };
    }

    function refreshPreviewSoft() {
      var side = document.querySelector(".ne-side");
      if (side) {
        var html = previewHtml();
        var tmp = document.createElement("div");
        tmp.innerHTML = html;
        var next = tmp.firstChild;
        side.parentNode.replaceChild(next, side);
        [].forEach.call(document.querySelectorAll(".ne-side [data-toggle]"), function (b) {
          b.addEventListener("click", function () {
            var on = b.getAttribute("aria-checked") !== "true";
            b.setAttribute("aria-checked", on ? "true" : "false");
            draft[b.getAttribute("data-toggle")] = on;
          });
        });
        if ($("neDocAdd")) $("neDocAdd").addEventListener("click", function () {
          readDom(); draft.step = 3; draw();
        });
      }
      var meta = document.querySelector(".ne-prog-meta span");
      if (meta) meta.textContent = "Profile " + completionPct() + "% complete";
    }

    function profilePayload() {
      var months = Number(draft.probationMonths) || 0;
      var probationEnd = "";
      if (months && draft.startDate) {
        var d = new Date(draft.startDate + "T00:00:00");
        d.setMonth(d.getMonth() + months);
        probationEnd = d.toISOString().slice(0, 10);
      }
      var phone = [draft.phoneCode, draft.phone].filter(Boolean).join(" ").trim();
      var emergency = [draft.emergencyName, draft.emergencyRelation, draft.emergencyPhone].filter(Boolean).join(" · ");
      return {
        full_name: fullName(),
        preferred_name: draft.preferredName || null,
        email: draft.email.trim().toLowerCase(),
        employee_no: staffLoginId() || null,
        staff_login_id: staffLoginId() || null,
        dob: draft.dob || null,
        gender: draft.gender || null,
        phone: phone || null,
        id_kind: draft.idKind || null,
        id_number: draft.idNumber || null,
        address: draft.address || null,
        current_address: draft.currentAddress || null,
        department_id: draft.departmentId || null,
        job_title_id: draft.titleId || null,
        employment_type: draft.employmentType || null,
        staff_category: draft.staffCategory || null,
        start_date: draft.startDate || null,
        probation_end: probationEnd || null,
        manager_id: draft.managerId || null,
        shift: draft.shift || null,
        roster: draft.roster || null,
        attendance_method: draft.attendanceMethod || null,
        work_days: draft.workDays,
        notes: draft.notes || null,
        docs_checklist: draft.docs,
        emergency_contact: emergency || null,
        nationality: draft.nationality || null,
        blood_group: draft.bloodGroup || null,
        bank_name: draft.bankName || null,
        account_name: draft.accountName || null,
        account_number: draft.accountNumber || null,
        allowances: chosenAllowances(),
        role: draft.role || "staff",
        flags: {
          send_welcome: !!draft.sendWelcome,
          create_account: !!draft.createAccount,
          add_to_roster: !!draft.addToRoster
        }
      };
    }

    /* Cursor 2026-10-23: prefer create_employee_invite (0050) so profile is on invite.meta + settings. */
    function savePendingDraft(inviteId, email, profile) {
      var key = "8_pending_employee_invites";
      var list = (company.settings && company.settings[key]) || [];
      if (!Array.isArray(list)) list = [];
      list = list.filter(function (x) { return x && x.email !== email; });
      list.push({ invite_id: inviteId, email: email, created_at: new Date().toISOString(), profile: profile });
      if (list.length > 40) list = list.slice(-40);
      return rpc("set_company_setting", { p_company: company.id, p_key: key, p_value: list }).then(function () {
        company.settings = company.settings || {};
        company.settings[key] = list;
      }).catch(function () { /* non-HR may still create invite */ });
    }

    function createInviteFallback(mail, profile) {
      var row = { company_id: company.id, email: mail, role: draft.role || "staff", meta: { profile: profile } };
      return db.from("company_invites").insert(row).select().single().then(function (ins) {
        if (ins.error && /meta/i.test(ins.error.message || "")) {
          delete row.meta;
          return db.from("company_invites").insert(row).select().single();
        }
        return ins;
      }).then(function (ins) {
        if (ins.error) throw new Error(ins.error.message);
        return savePendingDraft(ins.data.id, mail, profile).then(function () { return ins.data; });
      });
    }

    function createInvite(mail, profile) {
      /* api.rpc throws on error and returns data (invite row). */
      return rpc("create_employee_invite", {
        p_company: company.id,
        p_email: mail,
        p_role: draft.role || "staff",
        p_profile: profile,
        p_role_label: null
      }).then(function (data) {
        return Array.isArray(data) ? data[0] : data;
      }, function () {
        return createInviteFallback(mail, profile);
      });
    }

    function saveName(uid, name) {
      return rpc("set_staff_name", { p_company: company.id, p_user: uid, p_name: name }).catch(function (e) {
        var msg = e.message || "";
        if (!/set_staff_name|schema cache|Could not find the function/i.test(msg)) throw e;
        if (api.ctx && uid === api.ctx.me) {
          return db.from("profiles").update({ full_name: name }).eq("id", uid).then(function (r) {
            if (r.error) throw new Error(r.error.message);
          });
        }
      });
    }

    function submitEdit() {
      readDom();
      var err = validateStep(0) || validateStep(1) || validateStep(4);
      if (err) { say(err, "err"); return; }
      var profile = profilePayload();
      var uid = editing.uid;
      var phone = [draft.phoneCode, draft.phone].filter(Boolean).join(" ").trim();
      var emergency = [draft.emergencyName, draft.emergencyRelation, draft.emergencyPhone].filter(Boolean).join(" · ");
      var btn = $("neSubmit");
      if (btn) btn.disabled = true;
      say("Saving…");
      var chain = Promise.resolve();
      if (canHr) {
        var org = {
          department_id: draft.departmentId || null,
          job_title_id: draft.titleId || null,
          staff_category: draft.staffCategory || "",
          employment_type: draft.employmentType || "",
          start_date: draft.startDate || "",
          employee_no: staffLoginId() || ""
        };
        if (draft.managerId) org.manager_id = draft.managerId;
        else if (editing.managerId) org.manager_id = null;
        var pro = { phone: phone, emergency_contact: emergency, probation_end: profile.probation_end || "" };
        chain = chain
          .then(function () { return rpc("set_member_org", { p_company: company.id, p_user: uid, p_patch: org }); })
          .then(function () { return rpc("set_member_profile", { p_company: company.id, p_user: uid, p_patch: pro }); })
          .then(function () { return rpc("apply_invite_profile", { p_company: company.id, p_user: uid, p_profile: profile }); })
          .then(function () {
            return rpc("set_member_bank", {
              p_company: company.id,
              p_user: uid,
              p_bank: draft.bankName || "",
              p_account_name: draft.accountName || "",
              p_account_number: draft.accountNumber || ""
            });
          })
          .then(function () { return saveMemberAllowances(uid); });
        var canAdmin = api.ctx && (api.ctx.isAdmin || api.ctx.myRole === "owner" || api.ctx.isPlatform);
        if (canAdmin && editing.role !== "owner" && draft.role && draft.role !== editing.role) {
          chain = chain.then(function () {
            return db.from("company_members").update({ role: draft.role, role_label: null }).eq("company_id", company.id).eq("user_id", uid).then(function (r) {
              if (r.error) throw new Error(r.error.message);
            });
          });
        }
      } else {
        chain = chain.then(function () {
          return rpc("set_member_profile", { p_company: company.id, p_user: uid, p_patch: { phone: phone, emergency_contact: emergency } });
        });
      }
      var savedName = [draft.firstName, draft.lastName].filter(Boolean).join(" ").trim();
      chain.then(function () { return saveName(uid, savedName); }).then(function () {
        closeModal();
        if (api.reload) api.reload();
      }).catch(function (e) {
        if (btn) btn.disabled = false;
        say(e.message || String(e), "err");
      });
    }

    function submit() {
      if (editing) { submitEdit(); return; }
      readDom();
      var err = validateStep(0) || validateStep(draft.step);
      if (err) { say(err, "err"); return; }
      if (!draft.createAccount) {
        say("Turn on “Create user account” to send an invite, or ask Claude for a create-without-login RPC.", "err");
        return;
      }
      var mail = draft.email.trim().toLowerCase();
      var profile = profilePayload();
      say("Creating invite…");
      var btn = $("neSubmit");
      if (btn) btn.disabled = true;
      createInvite(mail, profile).then(function (inv) {
        var token = inv.token || (inv[0] && inv[0].token);
        var url = location.origin + location.pathname.replace(/[^/]*$/, "") + "index.html?invite=" + token;
        var sid = staffLoginId();
        openModal(
          '<div class="ne-done"><h2>Invite ready</h2>' +
          '<p class="note">' + esc(fullName()) + " · " + esc(mail) +
            ". Their name, department, designation, and the rest of this form are saved and applied when they accept the invite.</p>" +
          (sid
            ? '<div class="fld"><label for="iStaffId">Staff login ID</label><input id="iStaffId" readonly value="' + esc(sid) + '">' +
              '<small class="ne-hint">After they set a password, they can sign in with this ID or their email.</small></div>'
            : "") +
          (draft.sendWelcome ? '<p class="ne-hint">Welcome email toggle is on — copy the link below to send it for now.</p>' : "") +
          '<div class="fld"><label for="iLink">Invite link (7 days)</label><input id="iLink" readonly value="' + esc(url) + '"></div>' +
          '<p class="msg ok" id="mMsg" role="status">Invite created.</p>' +
          '<div class="modal-actions"><button type="button" class="ghost" data-close>Done</button>' +
          (sid ? '<button type="button" class="ghost" id="iCopyStaff">Copy staff ID</button>' : "") +
          '<button type="button" class="save" id="iCopy">Copy link</button></div></div>',
          true
        );
        if ($("iCopyStaff") && sid) {
          $("iCopyStaff").addEventListener("click", function () {
            (navigator.clipboard ? navigator.clipboard.writeText(sid) : Promise.reject())
              .then(function () { say("Staff ID copied.", "ok"); }, function () { say("Select and copy the Staff login ID field.", ""); });
          });
        }
        $("iCopy").addEventListener("click", function () {
          $("iLink").select();
          (navigator.clipboard ? navigator.clipboard.writeText(url) : Promise.reject())
            .then(function () { say("Copied.", "ok"); }, function () { say("Press Ctrl+C to copy.", ""); });
        });
        if (api.reload) api.reload();
      }).catch(function (e) {
        if (btn) btn.disabled = false;
        say(e.message || String(e), "err");
      });
    }

    // Load / seed org lists so Department & Designation are never blank for a new company.
    orgBusy = true;
    draw();
    seedOrgIfEmpty().then(function () {
      orgBusy = false;
      if (draft.titleId) {
        var fromTitle = deptIdForTitle(draft.titleId);
        if (fromTitle) draft.departmentId = fromTitle;
      }
      if (!$("modal").hidden && document.querySelector(".ne-wiz")) draw();
    }).catch(function (e) {
      orgBusy = false;
      if (!$("modal").hidden && document.querySelector(".ne-wiz")) {
        draw();
        say(e.message || "Could not load departments / designations. Use + to add them.", "err");
      }
    });
  };
})();
