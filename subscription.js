/* Subscription state, the expired-app lock, and platform billing. All amounts come from the database. */
(function () {
  function esc(t) {
    return String(t == null ? "" : t).replace(/[&<>"']/g, function (c) {
      return { "&": "&amp;", "<": "&lt;", ">": "&gt;", '"': "&quot;", "'": "&#39;" }[c];
    });
  }
  function money(amount, currency) {
    var n = Number(amount);
    if (isNaN(n)) return "";
    return currency + " " + n.toLocaleString(undefined, { minimumFractionDigits: 2, maximumFractionDigits: 2 });
  }
  function every(plan) {
    if (plan.interval_unit === "lifetime") return "one time";
    var n = Number(plan.interval_count) || 1;
    var unit = plan.interval_unit === "year" ? "year" : "month";
    return n === 1 ? "per " + unit : "every " + n + " " + unit + "s";
  }
  function when(iso) {
    if (!iso) return "";
    return new Date(iso).toLocaleDateString(undefined, { day: "numeric", month: "short", year: "numeric" });
  }
  function daysLeft(iso) {
    if (!iso) return 0;
    return Math.max(0, Math.ceil((new Date(iso).getTime() - Date.now()) / 86400000));
  }
  function plansHtml(sub, renew) {
    var plans = sub.plans || [];
    if (!plans.length) return '<p class="note">No plans are published yet.</p>';
    return plans.map(function (p) {
      var btn = renew ? '<button type="button" class="ghost" data-renew="' + esc(p.id) + '">Renew</button>' : "";
      return '<div class="sub-plan"><span><strong>' + esc(p.name) + '</strong><small>' + esc(money(p.amount, sub.currency)) + " " + esc(every(p)) + '</small></span>' + btn + '</div>';
    }).join("");
  }
  function statusLine(sub) {
    if (sub.status === "lifetime") return "Lifetime";
    if (sub.status === "active") return (sub.plan_name || "Paid") + " · until " + when(sub.period_end);
    if (sub.status === "trial") return "Free trial · " + daysLeft(sub.trial_ends_at) + " days left";
    return "Subscription expired";
  }

  function paintStatus(sub) {
    var el = document.getElementById("appStatusText");
    if (el && sub) el.textContent = sub.locked ? "Subscription expired" : statusLine(sub);
  }

  function agoText(iso) {
    if (!iso) return "";
    var d = Math.floor((Date.now() - new Date(iso).getTime()) / 86400000);
    return d <= 0 ? "today" : d === 1 ? "yesterday" : d + " days ago";
  }
  function lockPlans(sub, admin) {
    var plans = sub.plans || [];
    if (!plans.length) return '<p class="lk-none">No plans are published yet. Contact KAHDHU to renew.</p>';
    var best = plans.filter(function (p) { return p.interval_unit === "year"; })[0] || null;
    return '<div class="lk-plans" role="radiogroup" aria-label="Plans">' + plans.map(function (p, i) {
      var star = best && best.id === p.id && plans.length > 1;
      return '<button type="button" class="lk-plan' + (i === (plans.indexOf(best) > -1 ? plans.indexOf(best) : 0) ? " on" : "") + '" role="radio" data-plan="' + esc(p.id) + '" data-name="' + esc(p.name) + '">' +
        (star ? '<em>Best value</em>' : "") + '<i class="lk-dot"></i><span><strong>' + esc(p.name) + '</strong><small>' + esc(every(p)) + '</small></span><b>' + esc(money(p.amount, sub.currency)) + '</b></button>';
    }).join("") + '</div>';
  }
  /* ---------- the lock screen: plan -> payment (deposit account + slip, checked by OCR) -> confirmation ---------- */
  function slipLib() {
    if (window.VeyoraSlip) return Promise.resolve(window.VeyoraSlip);
    return new Promise(function (ok, fail) {
      var s = document.createElement("script"); s.src = "slip-ocr.js?v=20261105s4";
      s.onload = function () { window.VeyoraSlip ? ok(window.VeyoraSlip) : fail(new Error("The slip reader did not load.")); };
      s.onerror = function () { fail(new Error("Could not load the slip reader.")); };
      document.head.appendChild(s);
    });
  }
  var SV = function (p) { return '<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round">' + p + '</svg>'; };
  var ICO = { ok: '<path d="m5 12 5 5 9-10"/>', warn: '<path d="M12 4 2.5 20h19zM12 10v5M12 17.5v.5"/>', fail: '<path d="M6 6l12 12M18 6 6 18"/>', copy: '<rect x="9" y="9" width="11" height="11" rx="2"/><path d="M5 15V6a2 2 0 0 1 2-2h8"/>', up: '<path d="M12 16V4M7 9l5-5 5 5M4 20h16"/>', bank: '<path d="M3 10 12 4l9 6M5 10v8M9 10v8M15 10v8M19 10v8M3 20h18"/>' };
  function stepper(n) {
    return '<ol class="lk-steps" aria-label="Steps">' + ["Plan", "Payment", "Confirmation"].map(function (t, i) { return '<li class="' + (i + 1 < n ? "done" : i + 1 === n ? "on" : "") + '"><i>' + (i + 1 < n ? SV(ICO.ok) : i + 1) + '</i>' + t + '</li>'; }).join("") + '</ol>';
  }
  function checksHtml(list) {
    return '<ul class="lk-checks">' + list.map(function (c) { return '<li class="' + c.level + '"><i>' + SV(c.level === "pass" ? ICO.ok : c.level === "warn" ? ICO.warn : ICO.fail) + '</i><span>' + esc(c.msg) + '</span></li>'; }).join("") + '</ul>';
  }

  function mountLock(db, companyId, sub, admin, platform) {
    var box = document.getElementById("subLock");
    if (!box) return;
    var endIso = sub.period_end && new Date(sub.period_end) > new Date(sub.trial_ends_at || 0) ? sub.period_end : sub.trial_ends_at;
    var wasPaid = !!sub.plan_name && sub.period_end;
    var S = { view: "plans", plan: null, req: null, accounts: [], acct: null, file: null, fields: null, checks: [], busy: false, reading: 0, result: null, preview: "" };

    box.innerHTML =
      '<div class="lk-orb a"></div><div class="lk-orb b"></div>' +
      '<div class="sub-card lk" role="dialog" aria-modal="true" aria-labelledby="subTitle">' +
        '<aside class="lk-hero"><span class="lk-ring"><span class="lk-ic">' + SV('<path d="M6 3h12M6 21h12M7 3v3a5 5 0 0 0 2 4l3 2-3 2a5 5 0 0 0-2 4v3M17 3v3a5 5 0 0 1-2 4l-3 2 3 2a5 5 0 0 1 2 4v3"/>') + '</span></span>' +
          '<h2 id="subTitle">' + (wasPaid ? "Your subscription has ended" : "Your free trial has ended") + '</h2>' +
          '<p class="lk-when">' + (endIso ? "Ended " + esc(when(endIso)) + " · " + esc(agoText(endIso)) : "Renew to continue using KAHDHU.") + '</p>' +
          '<ul class="lk-keep"><li>' + SV(ICO.ok) + 'Your data is safe. Nothing was deleted.</li><li>' + SV(ICO.ok) + 'Everything comes back the moment a plan is active.</li><li>' + SV(ICO.ok) + 'Staff, trips, bookings and finance stay as they were.</li></ul>' +
          '<div class="lk-sum" id="lkSum" hidden></div></aside>' +
        '<section class="lk-main" id="lkMain"></section></div>';
    box.hidden = false;
    var side = document.querySelector(".side"), main = document.querySelector(".main");
    if (side) side.inert = true;
    if (main) main.inert = true;
    var $m = function () { return document.getElementById("lkMain"); };
    function foot() { return '<div class="lk-foot">' + (platform ? '<a class="ghost" href="platform.html">Platform owner</a>' : "") + '<button type="button" class="ghost" id="subOut">Sign out</button></div>'; }
    function bindFoot() { var o = document.getElementById("subOut"); if (o) o.addEventListener("click", function () { db.auth.signOut().then(function () { location.replace("index.html"); }); }); }
    function say(t, k) { var m = document.getElementById("subMsg"); if (m) { m.textContent = t; m.className = "msg lk-msg " + (k || ""); } }
    function summary() {
      var el = document.getElementById("lkSum"); if (!el) return;
      if (!S.req) { el.hidden = true; return; }
      el.hidden = false; el.innerHTML = '<small>Renewal</small><strong>' + esc(S.req.plan_name) + '</strong><b>' + esc(money(S.req.amount, S.req.currency)) + '</b>';
    }

    /* ----- view 1: plans ----- */
    function viewPlans() {
      var plans = sub.plans || [];
      if (!admin) {
        $m().innerHTML = '<h3>Access is paused</h3><p class="lk-sub">A company owner or admin needs to renew the plan or redeem a code. Once they do, you can carry on right away.</p>' + lockPlans(sub, false) +
          '<div class="lk-ask">' + SV('<path d="M12 12a4 4 0 1 0 0-8 4 4 0 0 0 0 8ZM4 21c0-4 4-6 8-6s8 2 8 6"/>') + '<span>Ask your company owner or admin to renew.</span></div>' + foot();
        bindFoot(); return;
      }
      $m().innerHTML = stepper(1) + '<h3>Choose a plan to continue</h3><p class="lk-sub">Pick a plan, then pay by bank transfer and upload your slip. Your plan starts as soon as the payment is confirmed.</p>' + lockPlans(sub, admin) +
        '<button type="button" class="lk-cta" id="lkNext" disabled>Continue to payment</button><p class="msg lk-msg" id="subMsg" role="status"></p>' +
        '<details class="lk-code"><summary>Have a redeem code?</summary><form id="redeemForm" class="lk-form"><input id="redeemCode" maxlength="64" placeholder="Enter code" aria-label="Redeem code" autocomplete="off"><button class="save" type="submit">Redeem</button></form></details>' + foot();
      var els = $m().querySelectorAll(".lk-plan"), next = document.getElementById("lkNext");
      function pick(el) {
        [].forEach.call(els, function (x) { x.classList.toggle("on", x === el); x.setAttribute("aria-checked", x === el ? "true" : "false"); });
        S.plan = el.getAttribute("data-plan"); next.disabled = false; next.textContent = "Continue to payment · " + el.getAttribute("data-name");
      }
      [].forEach.call(els, function (el) { el.addEventListener("click", function () { pick(el); }); });
      var start = $m().querySelector(".lk-plan.on") || els[0]; if (start) pick(start);
      next.addEventListener("click", function () {
        next.disabled = true; say("Starting your renewal…");
        db.rpc("start_renewal", { p_company: companyId, p_plan: S.plan }).then(function (r) {
          if (r.error) { next.disabled = false; say(r.error.message, "err"); return; }
          S.req = r.data; loadAccounts().then(function () { S.view = "pay"; draw(); });
        });
      });
      var form = document.getElementById("redeemForm");
      if (form) form.addEventListener("submit", function (e) {
        e.preventDefault();
        var code = document.getElementById("redeemCode").value.trim();
        if (code.length < 6) { say("Enter the code.", "err"); return; }
        say("Checking…");
        db.rpc("redeem_code", { p_company: companyId, p_code: code }).then(function (r) {
          if (r.error || (r.data && r.data.error)) { say(r.error ? r.error.message : r.data.error, "err"); return; }
          location.reload();
        });
      });
      bindFoot();
    }

    /* ----- view 2: payment ----- */
    function loadAccounts() {
      return Promise.resolve(db.from("platform_bank_accounts").select("id,bank,account_name,account_no,currency,note").eq("active", true).order("sort").order("created_at")).then(function (r) {
        S.accounts = (r && r.data) || [];
        if (!S.acct || !S.accounts.some(function (a) { return a.id === S.acct; })) S.acct = S.req && S.req.account_id && S.accounts.some(function (a) { return a.id === S.req.account_id; }) ? S.req.account_id : (S.accounts[0] ? S.accounts[0].id : null);
      });
    }
    function acctObj() { return S.accounts.filter(function (a) { return a.id === S.acct; })[0]; }
    function recheck() {
      var a = acctObj(); if (!S.fields || !a) { S.checks = []; return; }
      S.checks = window.VeyoraSlip.check(S.fields, { amount: Number(S.req.amount), currency: S.req.currency, account_no: a.account_no, bank: a.bank, createdAt: S.req.created_at });
    }
    function fieldsHtml() {
      var f = S.fields; if (!f) return "";
      function inp(k, label, ph) { return '<label class="lk-fld"><span>' + label + '</span><input data-f="' + k + '" value="' + esc(f[k] || "") + '" placeholder="' + ph + '" autocomplete="off"></label>'; }
      return '<div class="lk-read"><h4>What we read on your slip <small>' + esc([f.bank, f.transaction_type].filter(Boolean).join(" · ") || "Fix anything that is wrong") + '</small></h4><div class="lk-fields">' + inp("amount", "Amount", "0.00") + inp("to_account", "Paid to account", "Account number") + inp("reference_no", "Reference", "Reference or Id#") + inp("transaction_date", "Date and time", "YYYY-MM-DD HH:MM:SS") +
        '<label class="lk-fld"><span>Status</span><select data-f="status"><option value="">Not read</option><option value="SUCCESS"' + (/succ|compl/i.test(f.status || "") ? " selected" : "") + '>Success</option><option value="FAILED"' + (/fail/i.test(f.status || "") ? " selected" : "") + '>Failed</option></select></label>' +
        '<label class="lk-fld"><span>Bank</span><input data-f="bank" value="' + esc(f.bank || "") + '" placeholder="MIB or BML" autocomplete="off"></label></div><div id="lkChecks"></div></div>';
    }
    function paintChecks() {
      var el = document.getElementById("lkChecks"); if (!el) return;
      el.innerHTML = S.checks.length ? checksHtml(S.checks) : "";
      var btn = document.getElementById("lkSubmit"); if (btn) { var v = S.checks.length ? window.VeyoraSlip.verdict(S.checks) : "none"; btn.disabled = S.busy || !S.file || v === "rejected" || v === "none"; btn.textContent = v === "rejected" ? "Fix the problems above" : v === "review" ? "Submit for review" : "Submit slip"; }
    }
    function viewPay() {
      var a = acctObj(), r = S.req;
      $m().innerHTML = stepper(2) + '<h3>Pay ' + esc(money(r.amount, r.currency)) + '</h3><p class="lk-sub">' + esc(r.plan_name) + ' plan · <button type="button" class="lk-link" id="lkBack">Change plan</button></p>' +
        (S.accounts.length
          ? '<h4 class="lk-h">1. Transfer to one of these accounts</h4><div class="lk-accts" role="radiogroup" aria-label="Deposit account">' + S.accounts.map(function (x) {
              return '<div class="lk-acct' + (x.id === S.acct ? " on" : "") + '" role="radio" tabindex="0" data-acct="' + esc(x.id) + '" aria-checked="' + (x.id === S.acct) + '"><span class="lk-bk">' + SV(ICO.bank) + '</span><span class="lk-ai"><strong>' + esc(x.bank) + '</strong><small>' + esc(x.account_name) + '</small><code>' + esc(x.account_no) + '</code>' + (x.note ? '<em>' + esc(x.note) + '</em>' : "") + '</span><button type="button" class="lk-copy" data-copy="' + esc(x.account_no) + '" aria-label="Copy account number">' + SV(ICO.copy) + '<span>Copy</span></button></div>';
            }).join("") + '</div>'
          : '<p class="lk-none">No deposit accounts are set up yet. Contact KAHDHU to pay.</p>') +
        '<h4 class="lk-h">2. Upload your transfer slip</h4>' +
        '<label class="lk-drop" id="lkDrop"><input type="file" id="lkFile" accept="image/png,image/jpeg,image/webp"><span class="lk-up">' + SV(ICO.up) + '</span><strong>' + (S.file ? "Choose a different slip" : "Drop your slip here or click to choose") + '</strong><small>Screenshot or photo, PNG, JPG or WebP, up to 8 MB</small></label>' +
        '<div id="lkReadBox">' + (S.preview ? '<div class="lk-prev"><img src="' + esc(S.preview) + '" alt="Your slip"><div class="lk-prog" id="lkProg"' + (S.reading ? "" : " hidden") + '><i style="width:' + Math.round(S.reading * 100) + '%"></i><span>Reading your slip…</span></div></div>' : "") + fieldsHtml() + '</div>' +
        '<button type="button" class="lk-cta" id="lkSubmit" disabled>Submit slip</button><p class="msg lk-msg" id="subMsg" role="status"></p>' + foot();
      bindFoot(); paintChecks();
      document.getElementById("lkBack").addEventListener("click", function () { S.view = "plans"; draw(); });
      [].forEach.call($m().querySelectorAll("[data-acct]"), function (el) {
        function pickA() { S.acct = el.getAttribute("data-acct"); recheck(); [].forEach.call($m().querySelectorAll("[data-acct]"), function (x) { x.classList.toggle("on", x === el); x.setAttribute("aria-checked", x === el ? "true" : "false"); }); paintChecks(); }
        el.addEventListener("click", function (e) { if (!e.target.closest("[data-copy]")) pickA(); });
        el.addEventListener("keydown", function (e) { if (e.key === "Enter" || e.key === " ") { e.preventDefault(); pickA(); } });
      });
      [].forEach.call($m().querySelectorAll("[data-copy]"), function (b) {
        b.addEventListener("click", function () {
          var t = b.getAttribute("data-copy"), done = function () { b.classList.add("ok"); b.lastChild.textContent = "Copied"; setTimeout(function () { b.classList.remove("ok"); b.lastChild.textContent = "Copy"; }, 1500); };
          if (navigator.clipboard && navigator.clipboard.writeText) navigator.clipboard.writeText(t).then(done, function () {}); else done();
        });
      });
      var drop = document.getElementById("lkDrop"), file = document.getElementById("lkFile");
      ["dragover", "dragenter"].forEach(function (ev) { drop.addEventListener(ev, function (e) { e.preventDefault(); drop.classList.add("over"); }); });
      ["dragleave", "drop"].forEach(function (ev) { drop.addEventListener(ev, function (e) { e.preventDefault(); drop.classList.remove("over"); }); });
      drop.addEventListener("drop", function (e) { if (e.dataTransfer && e.dataTransfer.files[0]) takeFile(e.dataTransfer.files[0]); });
      file.addEventListener("change", function () { if (file.files[0]) takeFile(file.files[0]); });
      [].forEach.call($m().querySelectorAll("[data-f]"), function (el) {
        el.addEventListener("input", function () { S.fields[el.getAttribute("data-f")] = el.value.trim(); recheck(); paintChecks(); });
        el.addEventListener("change", function () { S.fields[el.getAttribute("data-f")] = el.value.trim(); recheck(); paintChecks(); });
      });
      document.getElementById("lkSubmit").addEventListener("click", submit);
      void a;
    }
    function takeFile(f) {
      if (!/^image\/(png|jpeg|webp)$/.test(f.type)) { say("Use a PNG, JPG or WebP image of the slip.", "err"); return; }
      if (f.size > 8 * 1024 * 1024) { say("That image is over 8 MB.", "err"); return; }
      S.file = f; S.fields = null; S.checks = []; S.reading = 0.02; try { if (S.preview) URL.revokeObjectURL(S.preview); } catch (e) {}
      S.preview = URL.createObjectURL(f); draw();
      slipLib().then(function (L) {
        return L.read(f, function (p) { S.reading = Math.max(.05, p); var bar = document.querySelector("#lkProg i"); if (bar) bar.style.width = Math.round(p * 100) + "%"; });
      }).then(function (res) {
        S.reading = 0; S.fields = res.fields; recheck(); draw();
        if (!S.fields.amount && !S.fields.reference_no && !S.fields.to_account) say("We could not read this image. Try a clearer screenshot of the slip.", "err");
      }, function (e) { S.reading = 0; S.fields = {}; recheck(); draw(); say((e && e.message) || "Could not read the slip. Fill the details in by hand.", "err"); });
    }
    function submit() {
      if (S.busy || !S.file || !S.fields) return;
      S.busy = true; paintChecks(); say("Uploading your slip…");
      var ext = S.file.type === "image/png" ? "png" : S.file.type === "image/webp" ? "webp" : "jpg", path = companyId + "/" + S.req.id + "-" + Date.now() + "." + ext;
      Promise.resolve(db.storage.from("payment-slips").upload(path, S.file, { contentType: S.file.type, upsert: false })).then(function (up) {
        if (up.error) throw new Error(up.error.message);
        return db.rpc("submit_payment_slip", { p_request: S.req.id, p_account: S.acct, p_path: path, p_ocr: S.fields });
      }).then(function (r) {
        S.busy = false;
        if (r.error) { say(r.error.message, "err"); paintChecks(); return; }
        S.result = r.data; S.view = "done"; draw();
      }, function (e) { S.busy = false; say(e.message || "Upload failed.", "err"); paintChecks(); });
    }

    /* ----- view 3: confirmation ----- */
    function viewDone() {
      var r = S.result || { slip_status: S.req.slip_status, checks: S.req.slip_check || [], activated: false }, st = r.slip_status, a = acctObj();
      var title = r.activated ? "You are all set" : st === "verified" ? "Slip verified" : st === "review" ? "Slip received, a person will check it" : st === "rejected" ? "We could not accept this slip" : "Slip received";
      var text = r.activated ? "Your plan is active. Reloading KAHDHU…" : st === "verified" ? "Everything on your slip matches. KAHDHU will switch your plan on shortly, usually within a few hours. You do not need to do anything else."
        : st === "review" ? "Some details were hard to read, so the KAHDHU team will check your slip by hand and activate your plan. You will get access as soon as that is done."
        : "The checks below did not pass. Upload the right slip, or fix the details it read, and try again.";
      $m().innerHTML = stepper(3) + '<div class="lk-res ' + (r.activated ? "verified" : st) + '"><span class="lk-resic">' + SV(st === "rejected" ? ICO.fail : st === "review" ? ICO.warn : ICO.ok) + '</span><div><h3>' + esc(title) + '</h3><p class="lk-sub">' + esc(text) + '</p></div></div>' +
        checksHtml(r.checks || []) +
        (st === "rejected" ? '<button type="button" class="lk-cta" id="lkRetry">Upload another slip</button>' : '<button type="button" class="lk-cta alt" id="lkRefresh">Check again</button>') + foot();
      bindFoot();
      var re = document.getElementById("lkRetry"); if (re) re.addEventListener("click", function () { S.view = "pay"; S.file = null; S.fields = null; S.checks = []; S.preview = ""; draw(); });
      var rf = document.getElementById("lkRefresh"); if (rf) rf.addEventListener("click", function () { location.reload(); });
      void a;
      if (r.activated) setTimeout(function () { location.reload(); }, 1800);
    }

    function draw() { summary(); if (S.view === "pay") viewPay(); else if (S.view === "done") viewDone(); else viewPlans(); }
    draw();
    if (admin) {
      // resume where the company left off
      db.rpc("my_renewal", { p_company: companyId }).then(function (r) {
        if (r.error || !r.data) return;
        S.req = r.data;
        loadAccounts().then(function () {
          if (r.data.slip_status && r.data.slip_status !== "none") { S.result = { slip_status: r.data.slip_status, checks: r.data.slip_check || [], activated: false }; S.view = "done"; }
          else S.view = "pay";
          draw();
        });
      });
    }
  }

  function clearLock() {
    var box = document.getElementById("subLock");
    if (box) box.hidden = true;
    var side = document.querySelector(".side");
    var main = document.querySelector(".main");
    if (side) side.inert = false;
    if (main) main.inert = false;
  }

  function watch(db, companyId, admin) {
    var platform = false;
    function say(t, k) {
      var m = document.getElementById("subMsg");
      if (m) { m.textContent = t; m.className = "msg " + (k || ""); }
    }
    function draw(sub) {
      paintStatus(sub);
      if (!sub.locked || platform) { clearLock(); return; }
      mountLock(db, companyId, sub, admin, platform);
    }
    function boxCard() { var b = document.getElementById("subLock"); return b ? b.querySelector(".sub-card") : null; }
    db.rpc("company_subscription", { p_company: companyId }).then(function (r) {
      if (r.error || !r.data) return;
      db.from("platform_admins").select("user_id").then(function (a) {
        platform = !!(a.data && a.data.length);
        draw(r.data);
      });
    });
  }

  function renderPanel(el, headerHtml, db, companyId, admin, onBack) {
    el.innerHTML = headerHtml + '<p class="msg">Loading…</p>';
    db.rpc("company_subscription", { p_company: companyId }).then(function (r) {
      if (r.error) { el.innerHTML = headerHtml + '<p class="msg err">' + esc(r.error.message) + '</p>'; }
      else {
        var sub = r.data;
        el.innerHTML = headerHtml +
          '<ul class="rows"><li class="row"><span class="grow"><strong>' + esc(statusLine(sub)) + '</strong><small>Trial length ' + esc(sub.trial_days) + ' days' + (sub.trial_override == null ? " (overall)" : " (this company)") + '</small></span><span class="tag">' + esc(sub.status) + '</span></li></ul>' +
          '<h3>Plans</h3><div class="sub-plans">' + plansHtml(sub, false) + '</div>' +
          (admin ? '<form id="panelRedeem" class="inv"><input id="panelCode" maxlength="64" placeholder="Redeem code" aria-label="Redeem code" autocomplete="off"><button class="save" type="submit">Redeem</button></form><p class="msg" id="panelSubMsg"></p>' : "");
        var form = document.getElementById("panelRedeem");
        if (form) form.addEventListener("submit", function (e) {
          e.preventDefault();
          var msg = document.getElementById("panelSubMsg");
          var code = document.getElementById("panelCode").value.trim();
          db.rpc("redeem_code", { p_company: companyId, p_code: code }).then(function (res) {
            var failed = res.error || (res.data && res.data.error);
            msg.textContent = failed ? (res.error ? res.error.message : res.data.error) : "Lifetime access is on.";
            msg.className = "msg " + (failed ? "err" : "ok");
            if (!failed) location.reload();
          });
        });
      }
      var back = el.querySelector("[data-back]");
      if (back && onBack) back.addEventListener("click", onBack);
    });
  }

  function mountPlatform(db) {
    var root = document.getElementById("billing");
    if (!root) return;
    root.innerHTML = '<h2>Subscriptions</h2><p class="msg">Loading…</p>';
    Promise.all([db.rpc("platform_billing"), db.rpc("platform_renewals"), db.from("platform_bank_accounts").select("*").order("sort").order("created_at"), db.rpc("platform_payment_settings")]).then(function (r) {
      if (r[0].error) { root.innerHTML = '<h2>Subscriptions</h2><p class="msg err">' + esc(r[0].error.message) + '</p>'; return; }
      var b = r[0].data, reqs = r[1].data || [], accts = (r[2] && r[2].data) || [], paySet = (r[3] && r[3].data) || {};
      root.innerHTML =
        '<h2>Subscriptions</h2><p class="note">Prices, the overall trial and the lifetime code are stored in the database. A company uses the overall trial unless you set one for that company.</p>' +
        '<form id="billForm" class="cards">' +
        '<div class="fld"><label for="trialDays">Overall free trial (days)</label><input id="trialDays" type="number" min="0" max="3650" value="' + esc(b.trial_days) + '"></div>' +
        '<div class="fld"><label for="billCur">Currency</label><input id="billCur" maxlength="3" value="' + esc(b.currency) + '"></div>' +
        '<div class="fld wide"><label for="lifeCode">Lifetime unlock code</label><input id="lifeCode" maxlength="64" value="' + esc(b.lifetime_code) + '" autocomplete="off"></div>' +
        '</form><div class="actions"><span class="msg" id="billMsg"></span><button type="button" class="save" id="billSave">Save subscription settings</button></div>' +
        '<h3>Plans</h3><div id="planRows"></div>' +
        '<div class="inv" style="margin-top:12px"><input id="newPlanName" placeholder="New plan name" maxlength="60" aria-label="New plan name"><input id="newPlanAmount" type="number" min="0" step="0.01" placeholder="Amount" aria-label="Amount"><select id="newPlanEvery" aria-label="Interval"><option value="month">per month</option><option value="year">per year</option><option value="lifetime">lifetime</option></select><button type="button" class="ghost" id="addPlan">Add plan</button></div>' +
        '<h3>Deposit accounts</h3><p class="note">Companies pay a renewal by bank transfer into one of these accounts, then upload the slip. The slip is read and checked against the account, amount, date and time.</p><div id="acctRows"></div>' +
        '<div class="inv" style="margin-top:12px;flex-wrap:wrap"><input id="newBank" placeholder="Bank (e.g. BML)" maxlength="80" aria-label="Bank name"><input id="newAcctName" placeholder="Account name" maxlength="120" aria-label="Account name"><input id="newAcctNo" placeholder="Account number" maxlength="40" aria-label="Account number"><input id="newAcctCur" placeholder="MVR" maxlength="3" value="MVR" style="width:70px" aria-label="Currency"><button type="button" class="save" id="addAcct">Add account</button></div>' +
        '<label class="lk-auto"><input type="checkbox" id="autoSlip"' + (paySet.auto_activate_slips ? " checked" : "") + '> Switch plans on automatically when a slip passes every check <small>Off: you grant each renewal yourself after looking at the slip.</small></label>' +
        '<h3>Renewal requests</h3><ul class="rows" id="renewals"></ul>';
      document.getElementById("acctRows").innerHTML = accts.map(function (a) {
        return '<div class="inv" data-acct="' + esc(a.id) + '" style="margin-bottom:8px;flex-wrap:wrap"><input data-a="bank" value="' + esc(a.bank) + '" maxlength="80" aria-label="Bank"><input data-a="account_name" value="' + esc(a.account_name) + '" maxlength="120" aria-label="Account name"><input data-a="account_no" value="' + esc(a.account_no) + '" maxlength="40" aria-label="Account number"><input data-a="currency" value="' + esc(a.currency) + '" maxlength="3" style="width:70px" aria-label="Currency">' +
          '<label class="lk-on"><input type="checkbox" data-a="active"' + (a.active ? " checked" : "") + '> Active</label><button type="button" class="ghost" data-save-acct="' + esc(a.id) + '">Save</button><button type="button" class="ghost danger" data-del-acct="' + esc(a.id) + '">Delete</button></div>';
      }).join("") || '<p class="note">No deposit accounts yet. Add one so companies know where to pay.</p>';
      document.getElementById("planRows").innerHTML = (b.plans || []).map(function (p) {
        return '<div class="inv" data-plan="' + esc(p.id) + '" style="margin-bottom:8px"><strong style="min-width:88px">' + esc(p.name) + '</strong>' +
          '<input data-f="amount" type="number" min="0" step="0.01" value="' + esc(p.amount) + '" aria-label="Amount">' +
          '<select data-f="interval" aria-label="Interval"><option value="month"' + (p.interval_unit === "month" ? " selected" : "") + '>month</option><option value="year"' + (p.interval_unit === "year" ? " selected" : "") + '>year</option><option value="lifetime"' + (p.interval_unit === "lifetime" ? " selected" : "") + '>lifetime</option></select>' +
          '<button type="button" class="ghost" data-save-plan="' + esc(p.id) + '" data-count="' + esc(p.interval_count) + '" data-active="' + (p.active ? 1 : 0) + '">Save</button></div>';
      }).join("");
      var BADGE = { verified: "Slip verified", review: "Slip needs review", rejected: "Slip failed checks", none: "No slip yet" };
      document.getElementById("renewals").innerHTML = reqs.length ? reqs.map(function (q) {
        var o = q.slip_ocr || {}, st = q.slip_status || "none";
        return '<li class="row lk-rq"><span class="grow"><strong>' + esc(q.company_name) + '</strong><small>' + esc(q.plan_name) + " · " + esc(money(q.amount, q.currency)) + " · " + esc(when(q.created_at)) + '</small>' +
          '<span class="lk-badge ' + st + '">' + BADGE[st] + '</span>' +
          (st !== "none" ? '<small class="lk-rqd">Paid into ' + esc(q.account_label || "?") + ' · slip shows ' + esc(o.amount || "?") + " " + esc(o.currency || "") + ", account " + esc(o.to_account || "?") + ", ref " + esc(o.reference_no || "?") + ", " + esc(o.transaction_date || "?") + '</small>' +
            '<ul class="lk-checks">' + (q.slip_check || []).map(function (c) { return '<li class="' + c.level + '"><i></i><span>' + esc(c.msg) + '</span></li>'; }).join("") + '</ul>' : "") + '</span>' +
          (q.slip_path ? '<button type="button" class="lk-thumb" data-view-slip="' + esc(q.slip_path) + '" aria-label="Open the slip image"><img alt="Transfer slip" data-slip-img="' + esc(q.slip_path) + '"><span>View slip</span></button>' : "") +
          '<button type="button" class="ghost" data-grant="' + q.id + '">Grant</button><button type="button" class="ghost danger" data-deny="' + q.id + '">Dismiss</button></li>';
      }).join("") : '<li class="row"><small>No open renewal requests.</small></li>';

      var slipPaths = reqs.filter(function (q) { return q.slip_path; }).map(function (q) { return q.slip_path; });
      if (slipPaths.length) db.storage.from("payment-slips").createSignedUrls(slipPaths, 3600).then(function (u) {
        ((u && u.data) || []).forEach(function (x) {
          if (!x.signedUrl) return;
          var img = document.querySelector('[data-slip-img="' + x.path + '"]');
          if (img) { img.src = x.signedUrl; img.parentNode.setAttribute("data-url", x.signedUrl); img.parentNode.classList.add("ready"); }
        });
      });
      function note(t, k) { var m = document.getElementById("billMsg"); m.textContent = t; m.className = "msg " + (k || ""); }
      document.getElementById("billSave").addEventListener("click", function () {
        db.rpc("platform_set_billing", {
          p_trial_days: Number(document.getElementById("trialDays").value),
          p_currency: document.getElementById("billCur").value.trim().toUpperCase(),
          p_lifetime_code: document.getElementById("lifeCode").value.trim()
        }).then(function (res) { note(res.error ? res.error.message : "Saved.", res.error ? "err" : "ok"); });
      });
      root.onclick = function (e) {
        var save = e.target.closest("[data-save-plan]");
        var grant = e.target.closest("[data-grant]");
        var deny = e.target.closest("[data-deny]");
        var saveA = e.target.closest("[data-save-acct]"), delA = e.target.closest("[data-del-acct]"), viewS = e.target.closest("[data-view-slip]");
        if (viewS) {
          var url = viewS.getAttribute("data-url");
          function show(u) {
            var lb = document.createElement("div"); lb.className = "lk-lightbox"; lb.innerHTML = '<button type="button" class="lk-lbx" aria-label="Close">&times;</button><img src="' + esc(u) + '" alt="Transfer slip"><a href="' + esc(u) + '" target="_blank" rel="noopener">Open full size</a>';
            lb.addEventListener("click", function (ev) { if (ev.target.tagName !== "A") lb.remove(); });
            document.addEventListener("keydown", function esc1(ev) { if (ev.key === "Escape") { lb.remove(); document.removeEventListener("keydown", esc1); } });
            document.body.appendChild(lb);
          }
          if (url) show(url);
          else db.storage.from("payment-slips").createSignedUrl(viewS.dataset.viewSlip, 600).then(function (u) { if (u.error || !u.data) alert(u.error ? u.error.message : "Could not open the slip."); else show(u.data.signedUrl); });
          return;
        }
        if (saveA) {
          var rowA = saveA.closest("[data-acct]"), g = function (k) { return rowA.querySelector('[data-a="' + k + '"]'); };
          db.from("platform_bank_accounts").update({ bank: g("bank").value.trim(), account_name: g("account_name").value.trim(), account_no: g("account_no").value.trim(), currency: g("currency").value.trim().toUpperCase(), active: g("active").checked })
            .eq("id", saveA.dataset.saveAcct).then(function (res) { if (res.error) alert(res.error.message); else note("Account saved.", "ok"); });
          return;
        }
        if (delA) {
          if (!confirm("Delete this deposit account? Renewals already paid into it keep their record.")) return;
          db.from("platform_bank_accounts").delete().eq("id", delA.dataset.delAcct).then(function (res) { if (res.error) alert(res.error.message); else mountPlatform(db); });
          return;
        }
        if (save) {
          var row = save.closest("[data-plan]");
          db.rpc("platform_save_plan", {
            p_id: save.dataset.savePlan, p_name: row.querySelector("strong").textContent,
            p_amount: Number(row.querySelector('[data-f="amount"]').value),
            p_interval: row.querySelector('[data-f="interval"]').value, p_count: Number(save.dataset.count) || 1, p_active: save.dataset.active !== "0"
          }).then(function (res) { if (res.error) alert(res.error.message); else note("Plan saved.", "ok"); });
        }
        if (grant || deny) {
          db.rpc("platform_resolve_renewal", { p_request: (grant || deny).dataset.grant || (grant || deny).dataset.deny, p_grant: !!grant })
            .then(function (res) { if (res.error) alert(res.error.message); else mountPlatform(db); });
        }
      };
      document.getElementById("addAcct").addEventListener("click", function () {
        var row = { bank: document.getElementById("newBank").value.trim(), account_name: document.getElementById("newAcctName").value.trim(), account_no: document.getElementById("newAcctNo").value.trim(), currency: (document.getElementById("newAcctCur").value.trim() || "MVR").toUpperCase(), sort: accts.length };
        if (!row.bank || !row.account_name || !row.account_no) { alert("Enter the bank, the account name and the account number."); return; }
        db.from("platform_bank_accounts").insert(row).then(function (res) { if (res.error) alert(res.error.message); else mountPlatform(db); });
      });
      document.getElementById("autoSlip").addEventListener("change", function (e) {
        var on = e.target.checked;
        if (on && !confirm("Plans will switch on automatically for slips that pass every check. The check runs on what the slip reader found, so look at slips now and then. Turn this on?")) { e.target.checked = false; return; }
        db.rpc("platform_set_auto_activate", { p_on: on }).then(function (res) { if (res.error) { alert(res.error.message); e.target.checked = !on; } else note(on ? "Automatic activation is on." : "Automatic activation is off.", "ok"); });
      });
      document.getElementById("addPlan").addEventListener("click", function () {
        var name = document.getElementById("newPlanName").value.trim();
        var id = name.toLowerCase().replace(/[^a-z0-9]+/g, "_").replace(/^_|_$/g, "").slice(0, 32);
        db.rpc("platform_save_plan", {
          p_id: id, p_name: name, p_amount: Number(document.getElementById("newPlanAmount").value),
          p_interval: document.getElementById("newPlanEvery").value, p_count: 1, p_active: true
        }).then(function (res) { if (res.error) alert(res.error.message); else mountPlatform(db); });
      });
    });
  }

  window.VeyoraSub = { watch: watch, renderPanel: renderPanel, mountPlatform: mountPlatform, statusLine: statusLine };
})();
