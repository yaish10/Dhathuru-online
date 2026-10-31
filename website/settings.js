(function () {
  var db = window.veyoraDb;
  var cats = window.VEYORA_SETTINGS;
  var company = null;
  var me = null;
  var myRole = "";
  var roles = ["admin", "operations", "hr", "it", "staff"];
  var roleInfo = {
    owner: "Full control, including company settings and staff.",
    admin: "Manages settings and staff. Cannot change the owner.",
    operations: "Works with trips, schedules, fleet and routes.",
    hr: "Works with crew, leave and HR records.",
    it: "Runs IT: networks, devices, assets, support tickets and IT settings.",
    staff: "Read access to company information."
  };
  var isPlatform = false;
  function isAdmin() { return isPlatform || myRole === "owner" || myRole === "admin"; }
  /* Cursor 2026-10-23: owners edit every settings category. */
  function isOwnerFull() { return isPlatform || myRole === "owner"; }
  var HR_CAT = 8, AGR_CAT = 16, IT_CATS = [17, 13, 14], MAINT_CAT = 10, FIN_CAT = 9;
  // HR and agreement settings are edited on the HR & Crew pages (Leave → Settings, Employees → Settings, and so on).
  // settings.html?in=hr and ?in=agreements go straight there. The main Settings page only points at those pages.
  // Cursor 2026-10-24: Finance Settings under Finance (?in=finance) — currencies & payment methods Ops follows.
  function hrHome(title) { return window.HrSettings && window.HrSettings.home(title === "Employee Categories" ? "Staff Categories" : title); }
  function pageHome(title) { return window.PageSettings && window.PageSettings.home(title); }
  function goneHome(title) { return hrHome(title) || pageHome(title); }
  var MODULES = {
    hr: { nav: "HR & Crew", cats: [HR_CAT, AGR_CAT], title: "HR Settings", sub: "", tip: "HR & Crew" },
    operations: { nav: "Operations", cats: [3, 4], title: "Operations Settings", sub: "", tip: "Operations" },
    schedules: { nav: "Schedules", cats: [5], title: "Schedule Settings", sub: "", tip: "Schedules" },
    fleet: { nav: "Fleet", cats: [6], title: "Fleet Settings", sub: "", tip: "Fleet" },
    passengers: { nav: "Passengers", cats: [7], title: "Passenger Settings", sub: "", tip: "Passengers" },
    maintenance: { nav: "Maintenance", cats: [MAINT_CAT], title: "Maintenance Settings", sub: "", tip: "Maintenance" },
    it: { nav: "IT", cats: IT_CATS, title: "IT Settings", sub: "", tip: "IT" },
    finance: { nav: "Finance", cats: [FIN_CAT], title: "Finance Settings", sub: "", tip: "Finance" }
  };
  var MOD_HOME = {
    hr: "hr.html#employees/settings", agreements: "agreements.html#settings/categories",
    operations: "operations.html#settings", schedules: "schedules.html#settings", fleet: "fleet.html#settings", passengers: "passengers.html#settings",
    maintenance: "maintenance.html#settings", it: "it.html#settings", finance: "finance.html#settings/general"
  };
  var modKey = (/[?&]in=([a-z]+)/.exec(location.search) || [])[1], inMod = MODULES[modKey] || null;
  if (MOD_HOME[modKey]) {
    var opened = (/open=([^&]+)/.exec(location.hash) || [])[1];
    var dest = (opened && goneHome(decodeURIComponent(opened))) || MOD_HOME[modKey];
    location.replace(dest);
    inMod = null;
  }
  var movedTo = {}; Object.keys(MODULES).forEach(function (k) { MODULES[k].cats.forEach(function (c) { movedTo[c] = k; }); });
  if (inMod) {
    document.title = inMod.title + " — VEYORA";
    var hd = document.querySelector(".page-head h1"), sb = document.querySelector(".page-head .sub"), pf = document.querySelector(".card.prefs");
    if (hd) hd.textContent = inMod.title; if (sb) sb.textContent = inMod.sub; if (pf) pf.hidden = true;
  }
  function shown(ci) { return inMod ? inMod.cats.indexOf(ci) > -1 : movedTo[ci] == null; }
  function catHref(ci) {
    if (ci === AGR_CAT) return MOD_HOME.agreements;
    var key = Object.keys(MODULES).filter(function (k) { return MODULES[k].cats.indexOf(ci) > -1; })[0];
    return key ? MOD_HOME[key] : "settings.html";
  }
  function $(id) { return document.getElementById(id); }
  var maintOk = false; // owners, admins, Operations, and people named for Maintenance approvals (is_company_maint)
  function canEditCat(ci) { return isOwnerFull() || isAdmin() || (myRole === "hr" && (ci === HR_CAT || ci === AGR_CAT)) || (myRole === "it" && IT_CATS.indexOf(ci) > -1) || ((maintOk || myRole === "operations") && ci === MAINT_CAT); }
  var active = 0, openItem = null;
  var els = {
    nav: document.getElementById("nav"), mgmt: document.getElementById("mgmt"), panel: document.getElementById("panel"),
    prefs: document.getElementById("prefs"), welcome: document.getElementById("welcome"),
    name: document.getElementById("userName"), role: document.getElementById("userRole"), avatar: document.getElementById("avatar")
  };
  var icons = {
    Dashboard: "M3 11 12 4l9 7v9H3z",
    Operations: "M4 15h16l-2 5H6zM8 15V9h8v6M12 9V4",
    Schedules: "M4 6h16v14H4zM4 10h16M9 3v4M15 3v4",
    Fleet: "M12 4v12M8 8h8M4 14c1 5 4 6 8 6s7-1 8-6",
    Passengers: "M12 12a4 4 0 1 0 0-8 4 4 0 0 0 0 8ZM4 21c0-4 4-6 8-6s8 2 8 6",
    "HR & Crew": "M9 11a3 3 0 1 0 0-6 3 3 0 0 0 0 6ZM3 20c0-3 3-5 6-5s6 2 6 5M17 6a3 3 0 0 1 0 6M21 20c0-2-1-4-3-4.6",
    Agreements: "M7 3h7l5 5v13H7zM14 3v5h5M9 15l2 2 4-4",
    Finance: "M4 6h16v12H4zM4 10h16M8 15h3",
    Maintenance: "M14 6a4 4 0 0 0-5 5L4 16l4 4 5-5a4 4 0 0 0 5-5l-3 3-3-1-1-3z",
    Reports: "M7 3h7l5 5v13H7zM14 3v5h5M10 13h6M10 17h6",
    Settings: "M12 15a3 3 0 1 0 0-6 3 3 0 0 0 0 6ZM19 12l2-1-2-4-2 .6-1.5-1L15 4H9l-.5 2.6-1.5 1L5 7l-2 4 2 1v1l-2 1 2 4 2-.6 1.5 1L9 20h6l.5-2.6 1.5-1 2 .6 2-4-2-1z"
  };
  var navItems = ["Dashboard", "Operations", "Schedules", "Fleet", "Passengers", "HR & Crew", "IT", "Finance", "Maintenance", "Reports", "Settings"];

  function esc(t) { return String(t == null ? "" : t).replace(/[&<>"']/g, function (c) { return { "&": "&amp;", "<": "&lt;", ">": "&gt;", '"': "&quot;", "'": "&#39;" }[c]; }); }

  if (window.VeyoraShell && window.VeyoraShell.nav) window.VeyoraShell.nav(inMod ? inMod.nav : "Settings");
  else els.nav.innerHTML = navItems.map(function (n) {
    var on = n === "Settings", href = on ? "settings.html" : n === "Dashboard" ? "dashboard.html" : n === "Operations" ? "operations.html" : n === "Schedules" ? "schedules.html" : n === "Fleet" ? "fleet.html" : n === "Passengers" ? "passengers.html" : n === "Finance" ? "finance.html" : n === "Reports" ? "reports.html" : n === "HR & Crew" ? "hr.html" : n === "IT" ? "it.html" : n === "Maintenance" ? "maintenance.html" : "#";
    return '<a href="' + href + '" class="' + (on ? "on" : href === "#" ? "off" : "") + '" title="' + n + '"' + (on ? ' aria-current="page"' : "") + '>' +
      '<svg viewBox="0 0 24 24"><path d="' + icons[n] + '"/></svg><span class="nav-label">' + n + '</span>' + (href === "#" ? '<span class="soon">Soon</span>' : "") +
      '<svg class="chev" viewBox="0 0 24 24"><path d="m9 6 6 6-6 6"/></svg></a>';
  }).join("");
  els.nav.addEventListener("click", function (e) { if (e.target.closest("a.off")) e.preventDefault(); });
  if (window.VeyoraShell && window.VeyoraShell.initSideCollapse) window.VeyoraShell.initSideCollapse();

  function itemTag(ci, title) {
    var spec = window.VEYORA_DEFS[title], k = itemKey(ci, title);
    if (!spec) return ["na", "Unavailable"];
    if (spec.type === "info" || spec.type === "status" || (spec.type === "it" && spec.managed && !spec.base && !spec.links)) return ["info", "Info"];
    if (spec.type === "notice-overview") return ["info", "Overview"];
    if (spec.type === "notice-type") {
      var nb = ((company && company.settings && company.settings["11_notice_types"]) || {})[spec.kind];
      if (nb && nb.enabled === false) return ["off", "Off"];
      if (nb) return ["changed", "Custom"];
      return ["def", "Default"];
    }
    if (!isLive(title)) return ["soon", "Upcoming"];
    if (customized(k)) return ["changed", "Changed"];
    return ["def", "Default"];
  }
  function navItem(ci, n) {
    var t = cats[ci].items[n], tag = itemTag(ci, t);
    var on = active === ci && openItem === n;
    return '<li class="nav-item' + (on ? " on" : "") + '" data-item="' + ci + ':' + n + '" tabindex="0" role="option" aria-selected="' + on + '"><strong>' + esc(t) + '</strong><span class="tag tag-' + tag[0] + '">' + tag[1] + '</span></li>';
  }
  function renderMgmt() {
    var y = els.mgmt.scrollTop;
    // In a module, its own groups come first in the order the module lists them (IT Settings before Security, for IT).
    var order = inMod ? inMod.cats.concat(cats.map(function (c, i) { return i; }).filter(function (i) { return inMod.cats.indexOf(i) < 0; })) : cats.map(function (c, i) { return i; });
    els.mgmt.innerHTML = order.map(function (i) { var c = cats[i];
      if (!shown(i)) {
        if (inMod) return "";
        var mod = MODULES[movedTo[i]];
        return '<li class="moved"><a class="cat-btn" href="' + catHref(i) + '"><span class="ic" style="background:' + c.tint + ";color:" + c.color + '">' + (i + 1) + '</span>' +
          '<span class="grow"><strong>' + esc(c.title) + '</strong><small>Now in ' + esc(mod.tip) + '</small></span><svg class="chev" viewBox="0 0 24 24"><path d="M7 17 17 7M9 7h8v8"/></svg></a></li>';
      }
      var live = [], later = [];
      c.items.forEach(function (t, n) { (isLive(t) ? live : later).push(n); });
      var open = i === active;
      var nested = "";
      if (open) {
        nested = '<ul class="set-items" role="listbox" aria-label="' + esc(c.title) + '">' +
          live.map(function (n) { return navItem(i, n); }).join("") +
          (later.length ? '<li class="nav-more"><button type="button" class="more-btn" data-more aria-expanded="false">Show ' + later.length + ' upcoming</button><ul class="set-items later" hidden>' + later.map(function (n) { return navItem(i, n); }).join("") + '</ul></li>' : "") +
        '</ul>';
      }
      return '<li class="' + (open ? "on" : "") + (live.length ? "" : " dim") + '">' +
        '<button type="button" class="cat-btn" data-cat="' + i + '" aria-expanded="' + open + '">' +
        '<span class="ic" style="background:' + c.tint + ";color:" + c.color + '">' + (i + 1) + '</span>' +
        '<span class="grow"><strong>' + esc(c.title) + '</strong><small>' + esc(c.hint) + (live.length ? "" : " · upcoming") + '</small></span>' +
        '<span class="count">' + (live.length || c.items.length) + '</span>' +
        '<svg class="chev" viewBox="0 0 24 24"><path d="' + (open ? "m6 9 6 6 6-6" : "m9 6 6 6-6 6") + '"/></svg></button>' + nested + '</li>';
    }).join("");
    els.mgmt.scrollTop = y;
    var selected = els.mgmt.querySelector(".nav-item.on");
    if (selected) selected.scrollIntoView({ block: "nearest" });
  }

  function renderPrefs() {
    var defs = [["Email alerts", "Critical operational updates", true], ["Daily summary", "Automatic end-of-day report", true], ["Compact lists", "Higher information density", false]];
    var saved = {};
    try { saved = JSON.parse(localStorage.getItem("veyora-prefs") || "{}"); } catch (e) {}
    els.prefs.innerHTML = defs.map(function (d, i) {
      var v = saved[d[0]] == null ? d[2] : saved[d[0]];
      return '<li><span><strong>' + d[0] + '</strong><small>' + d[1] + '</small></span><button type="button" class="sw" role="switch" data-pref="' + d[0] + '" aria-checked="' + v + '" aria-label="' + d[0] + '"></button></li>';
    }).join("");
  }
  els.prefs.addEventListener("click", function (e) {
    var b = e.target.closest(".sw"); if (!b) return;
    var on = b.getAttribute("aria-checked") !== "true";
    b.setAttribute("aria-checked", on);
    try {
      var s = JSON.parse(localStorage.getItem("veyora-prefs") || "{}"); s[b.dataset.pref] = on;
      localStorage.setItem("veyora-prefs", JSON.stringify(s));
    } catch (err) {}
  });

  var timezones = ["Indian/Maldives", "Asia/Colombo", "Asia/Dubai", "Asia/Kolkata", "Asia/Singapore", "Europe/London", "UTC"];
  var currencies = ["MVR", "USD", "EUR", "GBP", "LKR", "INR", "AED", "SGD"];
  var dateFormats = ["DD MMM YYYY", "DD/MM/YYYY", "MM/DD/YYYY", "YYYY-MM-DD"];
  var languages = ["English", "Dhivehi"];

  function opts(list, cur) { return list.map(function (v) { return '<option' + (v === cur ? " selected" : "") + '>' + esc(v) + '</option>'; }).join(""); }

  function logoPublicUrl(path) {
    if (!path) return "";
    var u = db.storage.from("company-logos").getPublicUrl(path).data.publicUrl || "";
    if (!u) return "";
    return u + (u.indexOf("?") >= 0 ? "&" : "?") + "t=" + Date.now();
  }

  function logoMarkup(inputId, path, name) {
    var url = logoPublicUrl(path);
    var letter = esc((name || "?").charAt(0).toUpperCase());
    return '<div class="logo-line">' +
      (url ? '<img id="logoImg" src="' + esc(url) + '" alt="">' : '<span class="ph" id="logoPh">' + letter + "</span>") +
      '<div class="logo-meta">' +
        '<button type="button" class="logo-pick" id="' + inputId + '_btn">Choose logo</button>' +
        '<input id="' + inputId + '" class="logo-file" type="file" accept="image/png,image/jpeg,image/webp,image/gif,.png,.jpg,.jpeg,.webp,.gif">' +
        '<small id="' + inputId + '_name">PNG, JPEG, WebP or GIF</small>' +
      "</div></div>";
  }

  function showLogoPreview(inputId, file) {
    var host = document.getElementById(inputId);
    if (!host) return;
    var line = host.closest(".logo-line");
    if (!line) return;
    var img = document.getElementById("logoImg");
    if (!img) {
      var ph = document.getElementById("logoPh");
      img = document.createElement("img");
      img.id = "logoImg";
      img.alt = "";
      if (ph) ph.replaceWith(img);
      else line.insertBefore(img, line.firstChild);
    }
    if (img._blobUrl) URL.revokeObjectURL(img._blobUrl);
    img._blobUrl = URL.createObjectURL(file);
    img.src = img._blobUrl;
    var name = document.getElementById(inputId + "_name");
    if (name) name.textContent = file.name + " · click Save to upload";
  }

  function bindLogoPicker(inputId, msgId) {
    var input = document.getElementById(inputId);
    var btn = document.getElementById(inputId + "_btn");
    if (!input) return;
    if (btn) {
      btn.addEventListener("click", function (e) {
        e.preventDefault();
        if (input.disabled) return;
        input.click();
      });
    }
    input.addEventListener("change", function () {
      var file = input.files && input.files[0];
      var msg = msgId ? document.getElementById(msgId) : null;
      if (!file) return;
      if (!isLogoFile(file)) {
        input.value = "";
        if (msg) { msg.textContent = "Choose a PNG, JPEG, WebP, or GIF logo."; msg.className = "msg err"; }
        return;
      }
      showLogoPreview(inputId, file);
      if (msg) { msg.textContent = "Logo ready — click Save to upload."; msg.className = "msg"; }
    });
  }

  function isLogoFile(file) {
    if (!file) return false;
    if (/^image\/(png|jpeg|webp|gif)$/i.test(file.type)) return true;
    return /\.(png|jpe?g|webp|gif)$/i.test(file.name || "");
  }

  function profilePanel() {
    var c = company;
    els.panel.innerHTML =
      '<h2>Organization profile</h2><p class="note">These details appear across company records and reports</p>' +
      '<form id="profileForm" novalidate><div class="cards">' +
      '<div class="fld"><label for="f_name">Company name</label><input id="f_name" value="' + esc(c.name) + '" maxlength="120" required></div>' +
      '<div class="fld"><label for="f_region">Operating region</label><input id="f_region" value="' + esc(c.region) + '" placeholder="e.g. Kaafu Atoll, Maldives"></div>' +
      '<div class="fld"><label for="f_email">Official email</label><input id="f_email" type="email" value="' + esc(c.email) + '"></div>' +
      '<div class="fld"><label for="f_phone">Contact number</label><input id="f_phone" type="tel" value="' + esc(c.phone) + '"></div>' +
      '<div class="fld"><label for="f_currency">Preferred currency</label><select id="f_currency">' + opts(currencies, c.currency) + '</select></div>' +
      '<div class="fld"><label for="f_tz">Time zone</label><select id="f_tz">' + opts(timezones, c.timezone) + '</select></div>' +
      '<div class="fld"><label for="f_df">Date format</label><select id="f_df">' + opts(dateFormats, c.date_format) + '</select></div>' +
      '<div class="fld"><label for="f_lang">Language</label><select id="f_lang">' + opts(languages, c.language) + '</select></div>' +
      '<div class="fld"><label for="f_reg">Registration number</label><input id="f_reg" value="' + esc(c.registration_no) + '"></div>' +
      '<div class="fld"><label>Company status</label><input value="' + esc(c.status) + '" readonly></div>' +
      '<div class="fld wide"><label for="f_addr">Office address</label><textarea id="f_addr" rows="2">' + esc(c.address) + '</textarea></div>' +
      '<div class="fld wide"><label>Logo &amp; branding</label>' + logoMarkup("f_logo", c.logo_path, c.name) + "</div>" +
      '</div><div class="actions"><span class="msg" id="profileMsg" role="status"></span>' +
      '<button class="save" type="submit" id="saveBtn"><svg viewBox="0 0 24 24"><path d="m5 12 5 5 9-10"/></svg>Save changes</button></div></form>';
    document.getElementById("profileForm").addEventListener("submit", saveProfile);
    bindLogoPicker("f_logo", "profileMsg");
    if (!isAdmin()) {
      Array.prototype.forEach.call(document.querySelectorAll("#profileForm input, #profileForm select, #profileForm textarea, #saveBtn, #f_logo_btn"), function (x) { x.disabled = true; });
      document.getElementById("profileMsg").textContent = "Only owners and admins can edit the company profile.";
    }
  }

  function resizeLogo(file) {
    return new Promise(function (resolve, reject) {
      if (!isLogoFile(file)) {
        reject(new Error("Choose a PNG, JPEG, WebP, or GIF logo."));
        return;
      }
      var r = new FileReader();
      r.onerror = function () { reject(new Error("That logo could not be read.")); };
      r.onload = function () {
        var img = new Image();
        img.onerror = function () { reject(new Error("That logo could not be read. Try a PNG or JPEG.")); };
        img.onload = function () {
          var s = Math.min(256 / img.width, 256 / img.height, 1), cv = document.createElement("canvas");
          cv.width = Math.max(1, Math.round(img.width * s)); cv.height = Math.max(1, Math.round(img.height * s));
          cv.getContext("2d").drawImage(img, 0, 0, cv.width, cv.height);
          cv.toBlob(function (b) { b ? resolve(b) : reject(new Error("That logo could not be read.")); }, "image/png");
        };
        img.src = r.result;
      };
      r.readAsDataURL(file);
    });
  }

  function saveProfile(e) {
    e.preventDefault();
    var msg = document.getElementById("profileMsg"), btn = document.getElementById("saveBtn");
    function v(id) { return document.getElementById(id).value.trim(); }
    function say(t, k) { msg.textContent = t; msg.className = "msg " + (k || ""); }
    var email = v("f_email");
    if (v("f_name").length < 2) { say("Enter the company name.", "err"); return; }
    if (email && !/^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(email)) { say("Enter a valid email, or leave it blank.", "err"); return; }
    btn.disabled = true; say("Saving…");
    var file = document.getElementById("f_logo").files[0];
    var chain = file ? resizeLogo(file).then(function (blob) {
      var path = company.id + "/logo.png";
      return db.storage.from("company-logos").upload(path, blob, { contentType: "image/png", upsert: true }).then(function (r) {
        if (r.error) throw new Error(r.error.message); return path;
      });
    }) : Promise.resolve(company.logo_path);
    chain.then(function (path) {
      return db.from("companies").update({
        name: v("f_name"), region: v("f_region") || null, email: email || null, phone: v("f_phone") || null,
        currency: v("f_currency"), timezone: v("f_tz"), date_format: v("f_df"), language: v("f_lang"),
        registration_no: v("f_reg") || null, address: v("f_addr") || null, logo_path: path
      }).eq("id", company.id).select().single();
    }).then(function (r) {
      if (r.error) throw new Error(r.error.message);
      company = r.data;
      var img = document.getElementById("logoImg");
      if (company.logo_path && img) img.src = logoPublicUrl(company.logo_path);
      say(file ? "Logo saved." : "Saved.", "ok");
    }).catch(function (err) { say(err.message || "Could not save.", "err"); })
      .then(function () { btn.disabled = false; });
  }

  // Some settings appear in two categories but are one setting; they live in their home category.
  /* Cursor 2026-10-24: Employee ID Format lives under HR UI but keeps settings key 2_… */
  var SHARED_HOME = { "Employment Types": 2, "Employee ID Format": 2, "Payroll Configuration": 8 };
  function homeCat(ci, title) { return SHARED_HOME[title] != null ? SHARED_HOME[title] : ci; }
  function itemKey(ci, title) { return homeCat(ci, title) + "_" + window.VeyoraEngine.slug(title); }
  function rolesStorageKey() {
    var i = 0;
    cats.forEach(function (c, n) { if (c.items.indexOf("Roles & Permissions") > -1) i = n; });
    return itemKey(i, "Roles & Permissions");
  }
  function customRoleNames() {
    var v = company && company.settings && company.settings[rolesStorageKey()];
    if (!v || !Array.isArray(v.roles)) return [];
    return v.roles.filter(function (n) { return typeof n === "string" && n.length > 1; });
  }
  function customized(key) { return !!(company && company.settings && company.settings[key] !== undefined); }

  // A setting is "in use" unless its description says it applies later.
  function isLive(title) { var h = (window.VEYORA_HELP || {})[title] || ""; return !/\bApplies\b|\bonce\b|\bNot used\b/.test(h); }

  function itemRow(ci, n, showCat) {
    var t = cats[ci].items[n], tag = itemTag(ci, t);
    var help = (window.VEYORA_HELP || {})[t];
    return '<li class="live" data-item="' + ci + ':' + n + '" tabindex="0" role="button"><span class="n">' + (n + 1) + '</span><span class="grow"><strong>' + esc(t) + '</strong>' +
      (showCat ? '<small class="crumb-s">' + esc(cats[ci].title) + '</small>' : "") + (help ? '<small>' + esc(help) + '</small>' : "") + '</span><span class="tag tag-' + tag[0] + '">' + tag[1] + '</span></li>';
  }

  // In-use settings first; settings for modules that don't exist yet are folded away.
  function itemRows(ci) {
    var live = [], later = [];
    cats[ci].items.forEach(function (t, n) { (isLive(t) ? live : later).push(n); });
    return (live.length ? '<ul class="items">' + live.map(function (n) { return itemRow(ci, n); }).join("") + '</ul>' : '<p class="note">None of these are in use yet. They apply as the matching modules launch.</p>') +
      (later.length ? '<button type="button" class="more-btn" data-more aria-expanded="' + (!live.length) + '">' + (live.length ? "Show " + later.length + " more for upcoming modules" : "Show all " + later.length) + '</button>' +
        '<ul class="items later"' + (live.length ? " hidden" : "") + '>' + later.map(function (n) { return itemRow(ci, n); }).join("") + '</ul>' : "");
  }

  function listPanel(i) {
    var c = cats[i], liveCount = c.items.filter(isLive).length;
    els.panel.innerHTML = '<div class="ed-head"><p class="ed-kicker">Settings</p><h2>' + esc(c.title) + '</h2></div><p class="purpose">' + esc(c.hint) + '</p><p class="note">' +
      (liveCount ? liveCount + " in use now" : "These apply as the matching modules launch") + (canEditCat(i) ? "" : " · view only") + '.</p><div class="empty pick">Choose a setting on the left to edit it.</div>';
  }

  // Search across every setting by name or description.
  function searchPanel(q) {
    var hits = [];
    cats.forEach(function (c, ci) { if (inMod && !shown(ci)) return; c.items.forEach(function (t, n) { var h = ((window.VEYORA_HELP || {})[t] || ""); if ((t + " " + h + " " + c.title).toLowerCase().indexOf(q) > -1) hits.push([ci, n]); }); });
    viewId++;
    els.panel.innerHTML = '<div class="ed-head"><p class="ed-kicker">Search</p><h2>Search settings</h2></div><p class="note">' + hits.length + ' result' + (hits.length === 1 ? "" : "s") + ' for “' + esc(q) + '”</p>' +
      (hits.length ? '<ul class="items">' + hits.slice(0, 60).map(function (h) { return shown(h[0]) ? itemRow(h[0], h[1], true) : movedRow(h[0], h[1]); }).join("") + '</ul>' : '<p class="note">No settings match. Try a different word.</p>');
  }
  function movedRow(ci, n) {
    var t = cats[ci].items[n], help = (window.VEYORA_HELP || {})[t];
    var href = goneHome(t) || (catHref(ci) + "#open=" + encodeURIComponent(t));
    return '<li class="live"><a class="moved-link" href="' + href + '"><span class="grow"><strong>' + esc(t) + '</strong><small class="crumb-s">' + esc(MODULES[movedTo[ci]].tip) + '</small>' + (help ? '<small>' + esc(help) + '</small>' : "") + '</span><span class="tag tag-info">Open</span></a></li>';
  }
  function toggleMore(m) {
    var list = m.nextElementSibling; if (!list) return;
    var open = list.hidden;
    list.hidden = !open; m.setAttribute("aria-expanded", open);
    m.textContent = open ? "Hide upcoming" : "Show " + list.querySelectorAll(".nav-item, .live").length + " upcoming";
  }
  els.panel.addEventListener("click", function (e) {
    var m = e.target.closest("[data-more]"); if (!m) return;
    toggleMore(m);
  });
  var setSearch = document.getElementById("setSearch");
  if (setSearch) setSearch.addEventListener("input", function () {
    var q = setSearch.value.trim().toLowerCase();
    if (q.length >= 2) searchPanel(q); else if (!q) select(active);
  });

  function saveSetting(key, val) {
    return db.rpc("set_company_setting", { p_company: company.id, p_key: key, p_value: val }).then(function (r) {
      if (r.error) throw new Error(r.error.message);
      company.settings = company.settings || {}; company.settings[key] = val;
    });
  }

  function loadAudit() {
    return db.from("company_audit").select("action, detail, created_at, actor").eq("company_id", company.id).order("created_at", { ascending: false }).limit(50).then(function (r) {
      if (r.error) throw new Error(r.error.message.indexOf("permission") > -1 ? "Only owners and admins can view this." : r.error.message);
      var ids = r.data.map(function (x) { return x.actor; }).filter(Boolean);
      if (!ids.length) return r.data;
      return db.from("profiles").select("id, email").in("id", ids).then(function (p) {
        var by = {}; (p.data || []).forEach(function (x) { by[x.id] = x.email; });
        r.data.forEach(function (x) { x.by = by[x.actor]; });
        return r.data;
      });
    });
  }


  /* ---------- Organization & Departments (real records) ---------- */
  function memberName(m, byId) { var p = byId[m.user_id] || {}; return p.full_name || (p.email || "").split("@")[0] || "Unknown"; }
  function orgLoad() {
    return Promise.all([
      db.from("company_members").select("user_id, role, active, department_id, job_title_id, manager_id, employee_no, staff_category, employment_type, start_date").eq("company_id", company.id).order("created_at"),
      db.from("departments").select("id, name, head_user_id, active").eq("company_id", company.id).order("name"),
      db.from("job_titles").select("id, title, department_id, active, crew_group").eq("company_id", company.id).order("title")
    ]).then(function (r) {
      for (var i = 0; i < 3; i++) if (r[i].error) throw new Error(r[i].error.message);
      var ids = r[0].data.map(function (m) { return m.user_id; });
      return db.from("profiles").select("id, full_name, email").in("id", ids).then(function (p) {
        var by = {}; (p.data || []).forEach(function (x) { by[x.id] = x; });
        return { members: r[0].data, depts: r[1].data, titles: r[2].data, by: by };
      });
    });
  }
  function optList(items, cur, blank) {
    return '<option value="">' + esc(blank) + '</option>' + items.map(function (o) { return '<option value="' + esc(o[0]) + '"' + (o[0] === cur ? " selected" : "") + '>' + esc(o[1]) + '</option>'; }).join("");
  }
  function settingList(key, title) {
    var v = company.settings && company.settings[key];
    var spec = window.VEYORA_DEFS[title] || {};
    return Array.isArray(v) ? v : ((spec.base || spec).def || []);
  }
  function orgErr(e) { alert(e.message || e); }
  function setOrg(uid, patch) {
    return db.rpc("set_member_org", { p_company: company.id, p_user: uid, p_patch: patch }).then(function (r) { if (r.error) throw new Error(r.error.message); });
  }

  /* staff table: cols from department, title, manager, category, employment, empno, start */
  function staffTable(el, cols, redraw) {
    el.innerHTML = '<p class="msg">Loading staff…</p>';
    orgLoad().then(function (d) {
      var cats = settingList("2_staff_categories", "Staff Categories"), emps = settingList("2_employment_types", "Employment Types");
      var edit = isAdmin(), activeMembers = d.members.filter(function (m) { return m.active; });
      var head = { department: "Department", title: "Job title", manager: "Reports to", category: "Category", employment: "Employment", empno: "Employee ID", start: "Start date" };
      el.innerHTML = '<h3>Staff <small>' + d.members.length + '</small></h3><div class="mx-wrap"><table class="mx tbl"><thead><tr><th>Person</th>' + cols.map(function (c) { return '<th>' + head[c] + '</th>'; }).join("") + '</tr></thead><tbody>' +
        d.members.map(function (m) {
          var dis = edit ? "" : " disabled";
          var cell = {
            department: '<select data-f="department_id"' + dis + '>' + optList(d.depts.filter(function (x) { return x.active || x.id === m.department_id; }).map(function (x) { return [x.id, x.name]; }), m.department_id, "—") + '</select>',
            title: '<select data-f="job_title_id"' + dis + '>' + optList(d.titles.filter(function (x) { return (x.active && (!x.department_id || !m.department_id || x.department_id === m.department_id)) || x.id === m.job_title_id; }).map(function (x) { return [x.id, x.title]; }), m.job_title_id, "—") + '</select>',
            manager: '<select data-f="manager_id"' + dis + '>' + optList(activeMembers.filter(function (x) { return x.user_id !== m.user_id; }).map(function (x) { return [x.user_id, memberName(x, d.by)]; }), m.manager_id, m.role === "owner" ? "— (top)" : "Not set") + '</select>',
            category: '<select data-f="staff_category"' + dis + '>' + optList(cats.map(function (x) { return [x, x]; }).concat(m.staff_category && cats.indexOf(m.staff_category) < 0 ? [[m.staff_category, m.staff_category]] : []), m.staff_category, "—") + '</select>',
            employment: '<select data-f="employment_type"' + dis + '>' + optList(emps.map(function (x) { return [x, x]; }).concat(m.employment_type && emps.indexOf(m.employment_type) < 0 ? [[m.employment_type, m.employment_type]] : []), m.employment_type, "—") + '</select>',
            empno: m.employee_no ? '<strong>' + esc(m.employee_no) + '</strong>' : (edit ? '<button type="button" class="ghost" data-assign="' + m.user_id + '">Assign</button>' : "—"),
            start: '<input type="date" data-f="start_date" value="' + esc(m.start_date || "") + '"' + dis + '>'
          };
          return '<tr data-uid="' + m.user_id + '"><th scope="row" class="who2">' + esc(memberName(m, d.by)) + (m.active ? "" : ' <small>(suspended)</small>') + '<small>' + esc((d.by[m.user_id] || {}).email || "") + '</small></th>' + cols.map(function (c) { return '<td>' + cell[c] + '</td>'; }).join("") + '</tr>';
        }).join("") + '</tbody></table></div>' +
        (cols.indexOf("empno") > -1 && edit ? '<div class="actions"><span class="msg" id="orgMsg"></span><button type="button" class="save" id="assignAll">Assign IDs to everyone without one</button></div>' : '<p class="msg" id="orgMsg"></p>');
      [].forEach.call(el.querySelectorAll("[data-f]"), function (f) {
        f.addEventListener("change", function () {
          var patch = {}; patch[f.dataset.f] = f.value || null;
          if (f.dataset.f === "start_date") patch.start_date = f.value || "";
          setOrg(f.closest("tr").dataset.uid, patch).then(function () { var m = document.getElementById("orgMsg"); if (m) { m.textContent = "Saved."; m.className = "msg ok"; } if (f.dataset.f === "department_id") staffTable(el, cols, redraw); }).catch(function (e) { orgErr(e); staffTable(el, cols, redraw); });
        });
      });
      [].forEach.call(el.querySelectorAll("[data-assign]"), function (b) {
        b.addEventListener("click", function () { db.rpc("assign_employee_no", { p_company: company.id, p_user: b.dataset.assign }).then(function (r) { if (r.error) orgErr(r.error); company.settings = company.settings; if (redraw) redraw(); else staffTable(el, cols, redraw); }); });
      });
      var all = document.getElementById("assignAll");
      if (all) all.addEventListener("click", function () {
        var todo = d.members.filter(function (m) { return !m.employee_no; });
        if (!todo.length) { document.getElementById("orgMsg").textContent = "Everyone already has an ID."; return; }
        all.disabled = true;
        todo.reduce(function (p, m) { return p.then(function () { return db.rpc("assign_employee_no", { p_company: company.id, p_user: m.user_id }).then(function (r) { if (r.error) throw new Error(r.error.message); }); }); }, Promise.resolve())
          .then(function () { if (redraw) redraw(); else staffTable(el, cols, redraw); }).catch(orgErr).then(function () { all.disabled = false; });
      });
    }).catch(function (e) { el.innerHTML = '<p class="msg err">' + esc(e.message) + '</p>'; });
  }

  function hybrid(el, ctx, header, cols) {
    el.innerHTML = '<div id="orgTop"></div><div id="orgBottom"></div>';
    var top = document.getElementById("orgTop"), bottom = document.getElementById("orgBottom");
    window.VeyoraEngine.render(top, Object.assign({}, ctx, { spec: ctx.spec.base, value: company.settings ? company.settings[ctx.key] : undefined }));
    var redraw = function () { staffTable(bottom, cols, redraw); };
    redraw();
  }

  function recordList(el, ctx, header, cfg) {
    el.innerHTML = header(ctx) + '<div id="recWrap"><p class="msg">Loading…</p></div>';
    var wrap = document.getElementById("recWrap"), edit = cfg.canEdit != null ? cfg.canEdit : isAdmin();
    function draw() {
      orgLoad().then(function (d) {
        var rows = cfg.rows(d), have = rows.length;
        var seed = settingList(cfg.settingKey, cfg.settingTitle).filter(function (n) { return !cfg.names(d).some(function (x) { return x.toLowerCase() === n.toLowerCase(); }); });
        wrap.innerHTML = '<ul class="rows">' + (have ? rows.map(function (r) { return r.html; }).join("") : '<li class="row"><small>None yet.</small></li>') + '</ul>' +
          (edit ? '<div class="inv"><input id="recName" placeholder="' + cfg.placeholder + '" maxlength="80" aria-label="Name">' + (cfg.extraAdd ? cfg.extraAdd(d) : "") + '<button type="button" class="save" id="recAdd">Add</button></div>' +
            (seed.length ? '<p class="note" style="margin-top:12px">Suggested from your settings list: ' + seed.length + ' not created yet. <button type="button" class="ghost" id="recSeed">Create them</button></p>' : "") : "") +
          '<p class="msg" id="recMsg"></p>';
        var say = function (t, k) { var m = document.getElementById("recMsg"); m.textContent = t; m.className = "msg " + (k || ""); };
        var add = document.getElementById("recAdd");
        if (add) add.addEventListener("click", function () {
          var n = document.getElementById("recName").value.trim(); if (!n) { say("Enter a name.", "err"); return; }
          cfg.insert(d, [n]).then(function (r) { if (r.error) say(r.error.code === "23505" ? "That name already exists." : r.error.message, "err"); else draw(); });
        });
        var sd = document.getElementById("recSeed");
        if (sd) sd.addEventListener("click", function () { cfg.insert(d, seed).then(function (r) { if (r.error) say(r.error.message, "err"); else draw(); }); });
        [].forEach.call(wrap.querySelectorAll("[data-act]"), function (b) {
          var id = b.closest("li").dataset.id;
          var run = function (p) { p.then(function (r) { if (r.error) say(r.error.message, "err"); else draw(); }); };
          if (b.dataset.act === "toggle") b.addEventListener("click", function () { run(cfg.update(id, { active: b.getAttribute("aria-checked") !== "true" })); });
          if (b.dataset.act === "delete") b.addEventListener("click", function () { if (confirm("Delete this? People assigned to it will become unassigned.")) run(cfg.remove(id)); });
        });
        [].forEach.call(wrap.querySelectorAll("select[data-set]"), function (s2) {
          s2.addEventListener("change", function () { var p = {}; p[s2.dataset.set] = s2.value || null; cfg.update(s2.closest("li").dataset.id, p).then(function (r) { if (r.error) say(r.error.message, "err"); else say("Saved.", "ok"); }); });
        });
      }).catch(function (e) { wrap.innerHTML = '<p class="msg err">' + esc(e.message) + '</p>'; });
    }
    draw();
  }
  function rowShell(id, main, controls, active, edit) {
    if (edit == null) edit = isAdmin();
    return '<li class="row" data-id="' + id + '"><span class="grow">' + main + '</span>' + controls + (edit ? '<button type="button" class="sw" role="switch" data-act="toggle" aria-checked="' + active + '" aria-label="Active"></button><button type="button" class="ghost danger" data-act="delete">Delete</button>' : '<span class="tag">' + (active ? "Active" : "Inactive") + '</span>') + '</li>';
  }

  function orgDepartments(el, ctx, header) {
    var topDiv, staffDiv;
    el.innerHTML = '<div id="dTop"></div><div id="dStaff"></div>'; topDiv = document.getElementById("dTop"); staffDiv = document.getElementById("dStaff");
    var cfg = {
      settingKey: "2_department_management", settingTitle: "Department Management", placeholder: "New department name",
      names: function (d) { return d.depts.map(function (x) { return x.name; }); },
      rows: function (d) {
        return d.depts.map(function (x) {
          var count = d.members.filter(function (m) { return m.department_id === x.id; }).length;
          var heads = d.members.filter(function (m) { return m.active; }).map(function (m) { return [m.user_id, memberName(m, d.by)]; });
          return { html: rowShell(x.id, "<strong>" + esc(x.name) + "</strong><small>" + count + " staff</small>", '<select data-set="head_user_id" aria-label="Department head"' + (isAdmin() ? "" : " disabled") + '>' + optList(heads, x.head_user_id, "No head") + '</select>', x.active) };
        });
      },
      insert: function (d, names) { return db.from("departments").insert(names.map(function (n) { return { company_id: company.id, name: n }; })); },
      update: function (id, patch) { return db.from("departments").update(patch).eq("id", id).eq("company_id", company.id); },
      remove: function (id) { return db.from("departments").delete().eq("id", id).eq("company_id", company.id); }
    };
    recordList(topDiv, ctx, header, cfg);
    var redraw = function () { staffTable(staffDiv, ["department", "title"], redraw); };
    redraw();
  }


  /* Cursor 2026-10-23: Designations use department (not crew group). */
  var CREW_GROUPS = ["Captain", "Deck", "Engineering", "Shore", "Other"]; // still used by Approvers “applies to”
  function hrDesignations(el, ctx, header) {
    var edit = canEditCat(HR_CAT), dis = edit ? "" : " disabled";
    var cfg = {
      canEdit: edit, settingKey: "8_crew_positions", settingTitle: "Crew Positions", placeholder: "New designation, e.g. Second Engineer",
      names: function (d) { return d.titles.map(function (x) { return x.title; }); },
      rows: function (d) {
        return d.titles.map(function (x) {
          var count = d.members.filter(function (m) { return m.job_title_id === x.id; }).length;
          var dept = d.depts.filter(function (y) { return y.id === x.department_id; })[0];
          return { html: rowShell(x.id, "<strong>" + esc(x.title) + "</strong><small>" + count + " staff" + (dept ? " · " + esc(dept.name) : " · no department") + "</small>",
            '<select data-set="department_id" aria-label="Department"' + dis + '>' + optList(d.depts.map(function (y) { return [y.id, y.name]; }), x.department_id, "Select department") + '</select>', x.active, edit) };
        });
      },
      insert: function (d, names) { return db.from("job_titles").insert(names.map(function (n) { return { company_id: company.id, title: n }; })); },
      update: function (id, patch) { return db.from("job_titles").update(patch).eq("id", id).eq("company_id", company.id); },
      remove: function (id) { return db.from("job_titles").delete().eq("id", id).eq("company_id", company.id); }
    };
    recordList(el, ctx, header, cfg);
  }

  /* HR & Crew > Approvers & Responsibilities: only the duties live here now. Leave routing moved to HR > Leave & Absence > Settings
     (editor shared in approvers-ui.js; same saved value). */
  function hrApprovers(el, ctx, header) {
    window.VeyoraApprovers.render(el, { ctx: ctx, header: header, mode: "duties", edit: canEditCat(HR_CAT), company: function () { return company; },
      orgLoad: orgLoad, memberName: memberName, optList: optList, esc: esc, crewGroups: CREW_GROUPS, save: saveSetting });
  }

  function guessGroup(t) {
    if (/captain|master|skipper/i.test(t)) return "Captain";
    if (/engineer|mechanic|oiler/i.test(t)) return "Engineering";
    if (/deck|mate|officer|bosun|sailor|crew|purser|safety/i.test(t)) return "Deck";
    if (/manager|clerk|accountant|hr|ticket|dispatcher|admin|office/i.test(t)) return "Shore";
    return null;
  }

  function orgTitles(el, ctx, header) {
    var cfg = {
      settingKey: "2_job_titles_and_positions", settingTitle: "Job Titles & Positions", placeholder: "New job title",
      names: function (d) { return d.titles.map(function (x) { return x.title; }); },
      rows: function (d) {
        return d.titles.map(function (x) {
          var count = d.members.filter(function (m) { return m.job_title_id === x.id; }).length;
          return { html: rowShell(x.id, "<strong>" + esc(x.title) + "</strong><small>" + count + " staff</small>", '<select data-set="department_id" aria-label="Department"' + (isAdmin() ? "" : " disabled") + '>' + optList(d.depts.map(function (y) { return [y.id, y.name]; }), x.department_id, "Any department") + '</select>', x.active) };
        });
      },
      insert: function (d, names) { return db.from("job_titles").insert(names.map(function (n) { return { company_id: company.id, title: n }; })); },
      update: function (id, patch) { return db.from("job_titles").update(patch).eq("id", id).eq("company_id", company.id); },
      remove: function (id) { return db.from("job_titles").delete().eq("id", id).eq("company_id", company.id); }
    };
    recordList(el, ctx, header, cfg);
  }

  function orgChart(el, ctx, header) {
    el.innerHTML = '<div id="cTop"></div><div id="cTree"></div>';
    window.VeyoraEngine.render(document.getElementById("cTop"), Object.assign({}, ctx, { spec: ctx.spec.base, value: company.settings ? company.settings[ctx.key] : undefined }));
    var tree = document.getElementById("cTree"); tree.innerHTML = '<p class="msg">Loading chart…</p>';
    orgLoad().then(function (d) {
      var act = d.members.filter(function (m) { return m.active; }), ids = {}; act.forEach(function (m) { ids[m.user_id] = m; });
      var kids = {}; act.forEach(function (m) { var k = m.manager_id && ids[m.manager_id] ? m.manager_id : "root"; (kids[k] = kids[k] || []).push(m); });
      var dn = {}, tn = {}; d.depts.forEach(function (x) { dn[x.id] = x.name; }); d.titles.forEach(function (x) { tn[x.id] = x.title; });
      function node(m, depth) {
        var sub = (kids[m.user_id] || []).map(function (c) { return node(c, depth + 1); }).join("");
        return '<li><div class="org-node"><strong>' + esc(memberName(m, d.by)) + '</strong><small>' + esc([tn[m.job_title_id], dn[m.department_id]].filter(Boolean).join(" · ") || (m.role.charAt(0).toUpperCase() + m.role.slice(1))) + '</small></div>' + (sub ? '<ul>' + sub + '</ul>' : "") + '</li>';
      }
      var roots = (kids.root || []).sort(function (a, b) { return (a.role === "owner" ? 0 : 1) - (b.role === "owner" ? 0 : 1); });
      var byDept = d.depts.map(function (x) { return '<li class="row"><span class="grow"><strong>' + esc(x.name) + '</strong><small>' + act.filter(function (m) { return m.department_id === x.id; }).map(function (m) { return esc(memberName(m, d.by)); }).join(", ") + '</small></span><span class="tag">' + act.filter(function (m) { return m.department_id === x.id; }).length + '</span></li>'; }).join("");
      var none = act.filter(function (m) { return !m.department_id; }).length;
      tree.innerHTML = '<h3>Organization chart</h3>' + (roots.length ? '<ul class="org">' + roots.map(function (m) { return node(m, 0); }).join("") + '</ul>' : '<p class="note">No staff yet.</p>') +
        '<h3>By department</h3><ul class="rows">' + (byDept || '<li class="row"><small>No departments yet. Create them under <a href="hr.html#organization">HR → Departments &amp; Designations</a>.</small></li>') + (none ? '<li class="row"><span class="grow"><strong>Unassigned</strong></span><span class="tag">' + none + '</span></li>' : "") + '</ul>';
    }).catch(function (e) { tree.innerHTML = '<p class="msg err">' + esc(e.message) + '</p>'; });
  }

  function rolesEditor(el, ctx, header) {
    var spec = ctx.spec;
    var actions = spec.actions;
    var builtin = spec.builtin;
    var saved = ctx.value && typeof ctx.value === "object" ? ctx.value : {};
    var isNew = Array.isArray(saved.roles) && saved.grants && typeof saved.grants === "object";
    var custom = isNew ? saved.roles.filter(function (n) { return typeof n === "string"; }) : [];
    var grants = isNew ? saved.grants : saved;
    custom = custom.filter(function (n) {
      return builtin.indexOf(n) === -1 && n.toLowerCase() !== "owner";
    });

    function allowed(role, action) {
      if (role === "Owner") return true;
      if (grants[role] && typeof grants[role][action] === "boolean") return grants[role][action];
      return !!spec.defaults(role, action);
    }
    function snapshot() {
      var next = {};
      [].forEach.call(el.querySelectorAll("input[data-role]"), function (box) {
        if (box.dataset.role === "Owner") return;
        (next[box.dataset.role] = next[box.dataset.role] || {})[box.dataset.actn] = box.checked;
      });
      grants = next;
    }
    function say(t, k) {
      var m = document.getElementById("itemMsg");
      if (m) { m.textContent = t; m.className = "msg " + (k || ""); }
    }
    function addRole() {
      snapshot();
      var input = document.getElementById("newRole");
      var name = input.value.trim().replace(/\s+/g, " ");
      if (name.length < 2) { say("Enter a role name.", "err"); input.focus(); return; }
      if (!/^[A-Za-z0-9][A-Za-z0-9 &/.'-]{1,39}$/.test(name)) { say("Use letters, numbers, and simple punctuation.", "err"); input.focus(); return; }
      var taken = ["Owner"].concat(builtin, custom);
      if (taken.some(function (r) { return r.toLowerCase() === name.toLowerCase(); })) { say("That role already exists.", "err"); input.focus(); return; }
      if (custom.length >= 20) { say("You can add up to 20 custom roles.", "err"); return; }
      custom.push(name);
      draw();
      var added = document.getElementById("newRole");
      if (added) added.focus();
    }
    function draw() {
      var roles = ["Owner"].concat(builtin, custom);
      el.innerHTML = header(ctx).replace("data-back", "data-role-back") +
        '<div class="mx-wrap"><table class="mx"><thead><tr><th>Role</th>' +
        actions.map(function (a) { return "<th>" + esc(a) + "</th>"; }).join("") +
        "</tr></thead><tbody>" +
        roles.map(function (role) {
          var cells = actions.map(function (a) {
            var dis = (!ctx.canEdit || role === "Owner") ? " disabled" : "";
            return '<td><input type="checkbox" data-role="' + esc(role) + '" data-actn="' + esc(a) + '"' +
              (allowed(role, a) ? " checked" : "") + dis + ' aria-label="' + esc(role + " " + a) + '"></td>';
          }).join("");
          var idx = custom.indexOf(role);
          var remove = idx > -1 && ctx.canEdit ? '<button type="button" class="ghost danger" data-drop-role="' + idx + '">Remove</button>' : "";
          return '<tr><th scope="row"><span class="role-name">' + esc(role) + remove + "</span></th>" + cells + "</tr>";
        }).join("") +
        "</tbody></table></div>" +
        (ctx.canEdit
          ? '<div class="inv" style="margin-top:14px"><input id="newRole" maxlength="40" placeholder="New role name" aria-label="New role name"><button type="button" class="ghost" id="addRole">Add role</button></div><p class="note">A new role can view records. Tick anything else it should do, then save.</p><div class="actions"><span class="msg" id="itemMsg" role="status"></span><button class="save" type="button" id="itemSave"><svg viewBox="0 0 24 24"><path d="m5 12 5 5 9-10"/></svg>Save changes</button></div>'
          : '<p class="msg">Only owners and admins can change this setting.</p>');
      var back = el.querySelector("[data-role-back]");
      if (back) back.addEventListener("click", ctx.onBack);
      var addBtn = document.getElementById("addRole");
      if (addBtn) {
        addBtn.addEventListener("click", addRole);
        document.getElementById("newRole").addEventListener("keydown", function (e) {
          if (e.key === "Enter") { e.preventDefault(); addRole(); }
        });
      }
      [].forEach.call(el.querySelectorAll("[data-drop-role]"), function (b) {
        b.addEventListener("click", function () {
          var name = custom[Number(b.dataset.dropRole)];
          if (!confirm('Remove the role "' + name + '"?')) return;
          snapshot();
          delete grants[name];
          custom.splice(Number(b.dataset.dropRole), 1);
          draw();
        });
      });
      var save = document.getElementById("itemSave");
      if (!save) return;
      save.addEventListener("click", function () {
        snapshot();
        var payload = { roles: custom.slice(), grants: {} };
        builtin.concat(custom).forEach(function (role) {
          payload.grants[role] = {};
          actions.forEach(function (a) { payload.grants[role][a] = !!(grants[role] && grants[role][a]); });
        });
        save.disabled = true;
        say("Saving…");
        Promise.resolve(ctx.save(payload)).then(function () { say("Saved.", "ok"); })
          .catch(function (e) { say(e.message || "Could not save.", "err"); })
          .then(function () { save.disabled = false; });
      });
    }
    draw();
  }

  var hooks = {
    roles: rolesEditor,
    subscription: function (el, ctx, header) {
      window.VeyoraSub.renderPanel(el, header(ctx), db, company.id, isAdmin(), ctx.onBack);
    },
    "org-departments": orgDepartments, "org-titles": orgTitles, "org-chart": orgChart, "hr-designations": hrDesignations, "hr-approvers": hrApprovers,
    // IT Settings groups: the rules form (if any), what the platform runs, and links to the IT pages that do the work.
    it: function (el, ctx, header) {
      var sp = ctx.spec;
      el.innerHTML = '<div id="itTop"></div>' + (sp.managed ? '<div class="it-managed"><strong>Managed by VEYORA</strong><p>' + esc(sp.managed) + '</p></div>' : "") +
        (sp.links && sp.links.length ? '<h3>Open</h3><ul class="rows">' + sp.links.map(function (l) { return '<li class="row"><span class="grow"><strong>' + esc(l[0]) + '</strong></span><a class="ghost" href="' + esc(l[1]) + '">Open →</a></li>'; }).join("") + '</ul>' : "");
      var top = document.getElementById("itTop");
      if (sp.base) window.VeyoraEngine.render(top, Object.assign({}, ctx, { spec: sp.base, value: company.settings ? company.settings[ctx.key] : undefined }));
      else top.innerHTML = header(ctx) + (sp.note ? '<p class="note">' + esc(sp.note) + '</p>' : "");
    },
    "hr-allowance-rules": function (el, ctx, header) {
      var list = Array.isArray(ctx.value) ? ctx.value : [];
      el.innerHTML = header(ctx) + '<ul class="rows">' + (list.length ? list.map(function (r) {
        return '<li class="row"><span class="grow"><strong>' + esc(r.name) + '</strong><small>' + esc(r.basis || "Fixed per month") + (r.active === false ? " · off" : "") + ((r.conditions || []).length ? " · " + r.conditions.length + " condition" + (r.conditions.length > 1 ? "s" : "") : "") + (r.tiers ? " · tiered" : "") + '</small></span></li>';
      }).join("") : '<li class="row"><span class="grow"><small>No rules yet.</small></span></li>') + '</ul>' +
        '<div class="actions"><span class="msg">Rules are built and tried out on HR &amp; Crew → Payroll &amp; Overtime.</span><a class="save" href="hr.html#payroll/rules">Open the rule builder</a></div>';
      var back = el.querySelector("[data-back]"); if (back) back.addEventListener("click", ctx.onBack);
    },
    "org-managers": function (el, ctx, h) { hybrid(el, ctx, h, ["manager"]); },
    "org-ids": function (el, ctx, h) { hybrid(el, ctx, h, ["empno", "start"]); },
    "org-categories": function (el, ctx, h) { hybrid(el, ctx, h, ["category"]); },
    "org-employment": function (el, ctx, h) { hybrid(el, ctx, h, ["employment"]); },
    users: function () { usersPanel(); },
    // Claude 2026-10-28: arrival detection editors (arrivals.js); platform owner, owners and admins edit.
    arrivals: function (el, ctx, header) {
      el.innerHTML = header(ctx) + '<div id="arrHost"></div>';
      var back = el.querySelector("[data-back]"); if (back) back.addEventListener("click", ctx.onBack);
      if (!window.VeyoraArrivals) { document.getElementById("arrHost").innerHTML = '<p class="msg err">Arrival detection could not load. Refresh the page.</p>'; return; }
      window.VeyoraArrivals.mountAdmin(document.getElementById("arrHost"), company, ctx.spec.tab, ctx.canEdit);
      if (isPlatform) el.querySelector(".ed-head").insertAdjacentHTML("beforeend", '<a class="ghost" href="arrival-lab.html">Open Arrival Lab →</a>');
    },
    // Claude 2026-10-29: one section per notification type (11_notice_types, migrations 0078 and 0079; catalogue in notice-types.js).
    "notice-type": function (el, ctx, header) {
      var kind = ctx.spec.kind, info = (window.VEYORA_NOTICES || []).filter(function (n) { return n.kind === kind; })[0] || { when: "", dflt: "", personal: false, tier: "team" };
      var all = (ctx.allSettings() || {})["11_notice_types"] || {};
      var v = all[kind] || {}, personal = info.tier === "personal";
      var cfg = { enabled: personal ? true : v.enabled !== false, keepDefault: personal ? true : v.keepDefault !== false, teams: Array.isArray(v.teams) ? v.teams.slice() : [],
        designations: Array.isArray(v.designations) ? v.designations.slice() : [], rosteredOnly: v.rosteredOnly !== false };
      var TEAMS = [["operations", "Operations"], ["hr", "HR"], ["it", "IT"], ["maintenance", "Maintenance"]];
      el.innerHTML = header(ctx) + '<p class="msg" id="nrLoad">Loading designations…</p>';
      var back = el.querySelector("[data-back]"); if (back) back.addEventListener("click", ctx.onBack);
      Promise.resolve(db.from("job_titles").select("title").eq("company_id", company.id).eq("active", true).order("title")).then(function (r) {
        var titles = (r.data || []).map(function (x) { return x.title; });
        cfg.designations.forEach(function (t) { if (titles.indexOf(t) < 0) titles.push(t); });
        draw(titles);
      });
      function sw(k, label, sub, on) { return '<div class="nr-row"><span><strong>' + esc(label) + '</strong><small>' + esc(sub) + '</small></span><button type="button" class="sw" role="switch" data-k="' + k + '" aria-checked="' + on + '" aria-label="' + esc(label) + '"' + (ctx.canEdit ? "" : " disabled") + '></button></div>'; }
      function lock(label, sub) { return '<div class="nr-row nr-lock"><span><strong>' + esc(label) + '</strong><small>' + esc(sub) + '</small></span><span class="nr-locked" title="Locked"><svg viewBox="0 0 24 24"><rect x="5" y="11" width="14" height="9" rx="2"/><path d="M8 11V8a4 4 0 0 1 8 0v3"/></svg>Always on</span></div>'; }
      function nobody() { return !cfg.enabled || (!cfg.keepDefault && !cfg.teams.length && !cfg.designations.length); }
      function draw(titles) {
        var dis = ctx.canEdit ? "" : " disabled", warn = info.tier === "safety";
        el.querySelector("#nrLoad").outerHTML = (cfg.enabled ? "" : '<div class="nr-off">This notice is switched off. Nobody is told when it happens.</div>') + '<div class="nr"><section class="nr-card">' +
          '<p class="nr-when"><strong>Sent when:</strong> ' + esc(info.when) + '<br><strong>By default it goes to:</strong> ' + esc(info.dflt) + '</p>' +
          (personal ? lock("Always sent to the person it is about", "This notice can never be turned off for them. You can only add other people below.")
            : sw("enabled", "Send this notice", "Turn off to stop it for everyone.", cfg.enabled) + sw("keepDefault", "Tell the people it normally goes to", "Turn off to send it only to the people you add below.", cfg.keepDefault)) +
          '</section><section class="nr-card"><h3>Also tell</h3>' +
          '<div class="nr-lab">Teams</div><div class="nr-chips">' + TEAMS.map(function (t) { return '<button type="button" class="nr-chip' + (cfg.teams.indexOf(t[0]) >= 0 ? " on" : "") + '" data-team="' + t[0] + '" aria-pressed="' + (cfg.teams.indexOf(t[0]) >= 0) + '"' + dis + '>' + t[1] + '</button>'; }).join("") + '</div>' +
          '<div class="nr-lab">Designations</div><div class="nr-chips">' + (titles.length ? titles.map(function (t) {
            return '<button type="button" class="nr-chip' + (cfg.designations.indexOf(t) >= 0 ? " on" : "") + '" data-t="' + esc(t) + '" aria-pressed="' + (cfg.designations.indexOf(t) >= 0) + '"' + dis + '>' + esc(t) + '</button>'; }).join("") : '<small>No designations yet. Add them under HR → Departments &amp; Designations.</small>') + '</div>' +
          sw("rosteredOnly", "Designations: only people on the duty roster that day", "Someone who is off or on leave is not told. For a trip, the trip's departure day counts, and a person with an assigned vessel hears only about that vessel's trips.", cfg.rosteredOnly) +
          '</section></div><div id="nrConfirm"></div><p class="note">The person who caused the notice is never told. In-app notices also reach phones as push notifications.</p>' +
          (ctx.canEdit ? '<div class="ed-foot actions"><span class="msg" id="itemMsg" role="status"></span>' + (all[kind] ? '<button type="button" class="ghost" id="nrReset">Reset to default</button>' : "") + '<button class="save" type="button" id="nrSave">Save changes</button></div>' : '<p class="msg">Only owners and admins can change this setting.</p>');
        [].forEach.call(el.querySelectorAll(".nr-chip[data-t]"), function (b) { b.addEventListener("click", function () { var i = cfg.designations.indexOf(b.dataset.t); if (i >= 0) cfg.designations.splice(i, 1); else cfg.designations.push(b.dataset.t); b.classList.toggle("on", i < 0); b.setAttribute("aria-pressed", i < 0); }); });
        [].forEach.call(el.querySelectorAll(".nr-chip[data-team]"), function (b) { b.addEventListener("click", function () { var i = cfg.teams.indexOf(b.dataset.team); if (i >= 0) cfg.teams.splice(i, 1); else cfg.teams.push(b.dataset.team); b.classList.toggle("on", i < 0); b.setAttribute("aria-pressed", i < 0); }); });
        [].forEach.call(el.querySelectorAll(".sw[data-k]"), function (b) { b.addEventListener("click", function () { var on = b.getAttribute("aria-checked") !== "true"; b.setAttribute("aria-checked", on); cfg[b.dataset.k] = on; }); });
        var sv = el.querySelector("#nrSave"), rs = el.querySelector("#nrReset"), m = function () { return document.getElementById("itemMsg"); };
        function persist(payload, okText) {
          var mm = m(); sv.disabled = true; if (rs) rs.disabled = true; mm.textContent = "Saving…"; mm.className = "msg";
          return Promise.resolve(db.rpc("set_notice_type", { p_company: company.id, p_kind: kind, p_cfg: payload })).then(function (r) {
            if (r.error) throw new Error(r.error.message);
            company.settings = company.settings || {}; var nt = company.settings["11_notice_types"] = Object.assign({}, company.settings["11_notice_types"] || {});
            if (payload === null) delete nt[kind]; else nt[kind] = r.data;
            mm.textContent = okText; mm.className = "msg ok";
            setTimeout(function () { ctx.onBack && ctx.onBack(); }, 700);
          }).catch(function (e) { mm.textContent = e.message || "Could not save."; mm.className = "msg err"; sv.disabled = false; if (rs) rs.disabled = false; });
        }
        sv.addEventListener("click", function () {
          if (!nobody()) { persist(cfg, "Saved."); return; }
          // Nobody would be told: ask first, saying so plainly.
          document.getElementById("nrConfirm").innerHTML = '<div class="nr-ask' + (warn ? " safety" : "") + '" role="alertdialog"><strong>' + (warn ? "This is a safety notice. " : "") + 'Nobody will be told about “' + esc(ctx.title.replace(/ Notice$/, "")) + '”.</strong>' +
            '<p>' + esc(info.when) + ' ' + (warn ? "Nobody would be warned when this happens. " : "") + 'Switch it off only if you are sure.</p><div class="nr-ask-acts"><button type="button" class="ghost" id="nrNo">Keep it on</button><button type="button" class="save danger" id="nrYes">Turn it off</button></div></div>';
          document.getElementById("nrNo").addEventListener("click", function () { document.getElementById("nrConfirm").innerHTML = ""; });
          document.getElementById("nrYes").addEventListener("click", function () { persist(cfg, "Saved."); });
        });
        if (rs) rs.addEventListener("click", function () { persist(null, "Reset to default."); });
      }
    },
    // Claude 2026-10-29: every notice in one table.
    "notice-overview": function (el, ctx, header) {
      var list = window.VEYORA_NOTICES || [], all = (ctx.allSettings() || {})["11_notice_types"] || {}, filter = "all";
      el.innerHTML = header(ctx) + '<div id="noBody"></div><h3 class="no-h">Recent changes</h3><ul class="rows" id="noLog"><li class="row"><small>Loading…</small></li></ul>';
      var back = el.querySelector("[data-back]"); if (back) back.addEventListener("click", ctx.onBack);
      function status(n) { var b = all[n.kind]; if (n.tier === "personal") return b && ((b.teams || []).length || (b.designations || []).length) ? ["changed", "Custom"] : ["def", "Default"]; if (b && b.enabled === false) return ["off", "Off"]; return b ? ["changed", "Custom"] : ["def", "Default"]; }
      function goesTo(n) {
        var b = all[n.kind] || {}, keep = n.tier === "personal" || b.keepDefault !== false, ex = (b.teams || []).map(function (t) { return t.charAt(0).toUpperCase() + t.slice(1); }).concat((b.designations || []));
        if (b.enabled === false && n.tier !== "personal") return "Nobody";
        return (keep ? n.dflt : "Only the people added") + (ex.length ? " + " + ex.join(", ") : "");
      }
      function draw() {
        var counts = { all: list.length, off: 0, changed: 0 };
        list.forEach(function (n) { var s = status(n)[0]; if (s === "off") counts.off++; if (s === "changed") counts.changed++; });
        var rows = list.filter(function (n) { return filter === "all" || status(n)[0] === filter; });
        document.getElementById("noBody").innerHTML = '<div class="no-stats"><div><b>' + counts.all + '</b><span>notices</span></div><div class="' + (counts.off ? "warn" : "") + '"><b>' + counts.off + '</b><span>switched off</span></div><div><b>' + counts.changed + '</b><span>customised</span></div></div>' +
          '<div class="nr-chips no-filter">' + [["all", "All"], ["off", "Off"], ["changed", "Customised"]].map(function (f) { return '<button type="button" class="nr-chip' + (filter === f[0] ? " on" : "") + '" data-f="' + f[0] + '">' + f[1] + '</button>'; }).join("") + '</div>' +
          '<div class="no-wrap"><table class="no-table"><thead><tr><th>Notice</th><th>Status</th><th>Goes to</th></tr></thead><tbody>' + (rows.length ? rows.map(function (n) { var st = status(n);
            return '<tr data-open="' + esc(n.title) + '" tabindex="0" role="button"><td><strong>' + esc(n.title.replace(/ Notice$/, "")) + '</strong><small>' + esc(n.group) + (n.tier === "personal" ? " · always reaches the person" : n.tier === "safety" ? " · safety" : "") + '</small></td><td><span class="tag tag-' + st[0] + '">' + st[1] + '</span></td><td class="no-to">' + esc(goesTo(n)) + '</td></tr>'; }).join("") : '<tr><td colspan="3"><small>Nothing here.</small></td></tr>') + '</tbody></table></div>';
        [].forEach.call(document.querySelectorAll("#noBody [data-f]"), function (b) { b.addEventListener("click", function () { filter = b.dataset.f; draw(); }); });
        [].forEach.call(document.querySelectorAll("#noBody [data-open]"), function (tr) { var go = function () { openByTitle(tr.dataset.open); }; tr.addEventListener("click", go); tr.addEventListener("keydown", function (e) { if (e.key === "Enter") go(); }); });
      }
      draw();
      Promise.resolve(db.from("company_audit").select("detail, created_at").eq("company_id", company.id).eq("action", "notice_changed").order("created_at", { ascending: false }).limit(10)).then(function (r) {
        var ul = document.getElementById("noLog"); if (!ul) return;
        var rowsd = r.data || [];
        ul.innerHTML = rowsd.length ? rowsd.map(function (x) { return '<li class="row"><span class="grow"><strong>' + esc(x.detail) + '</strong><small>' + esc(new Date(x.created_at).toLocaleString()) + '</small></span></li>'; }).join("") : '<li class="row"><small>No changes yet.</small></li>';
      });
    },
    logo: function (el, ctx, header) {
      el.innerHTML = header(ctx) + logoMarkup("lg_file", company.logo_path, company.name) +
        '<div class="actions"><span class="msg" id="itemMsg"></span><button class="save" type="button" id="lg_save">Save logo</button></div>';
      bindLogoPicker("lg_file", "itemMsg");
      if (!isAdmin()) {
        document.getElementById("lg_save").disabled = true;
        var pick = document.getElementById("lg_file_btn");
        if (pick) pick.disabled = true;
        document.getElementById("lg_file").disabled = true;
        document.getElementById("itemMsg").textContent = "Only owners and admins can change the logo.";
      }
      document.getElementById("lg_save").addEventListener("click", function () {
        var f = document.getElementById("lg_file").files[0], m = document.getElementById("itemMsg");
        if (!f) { m.textContent = "Choose a logo first."; m.className = "msg err"; return; }
        m.textContent = "Uploading…"; m.className = "msg";
        document.getElementById("lg_save").disabled = true;
        resizeLogo(f).then(function (blob) {
          var path = company.id + "/logo.png";
          return db.storage.from("company-logos").upload(path, blob, { contentType: "image/png", upsert: true }).then(function (u) {
            if (u.error) throw new Error(u.error.message);
            return db.from("companies").update({ logo_path: path }).eq("id", company.id).select().single();
          });
        }).then(function (r) {
          if (r.error) throw new Error(r.error.message);
          company = r.data;
          var img = document.getElementById("logoImg");
          if (img) img.src = logoPublicUrl(company.logo_path);
          var name = document.getElementById("lg_file_name");
          if (name) name.textContent = "Uploaded.";
          m.textContent = "Logo saved."; m.className = "msg ok";
        }).catch(function (e) { m.textContent = e.message || "Could not upload the logo."; m.className = "msg err"; })
          .then(function () { if (isAdmin()) document.getElementById("lg_save").disabled = false; });
      });
    }
  };

  function itemPanel(ci, n) {
    var title = cats[ci].items[n];
    // Cursor 2026-10-23: departments & designations live on HR page now.
    if (title === "Department Management" || title === "Job Titles & Positions" || title === "Designations" || title === "Crew Positions") {
      location.href = "hr.html#organization";
      return;
    }
    if (title === "Maintenance Approval") { openByTitle("Maintenance Approval Rules"); return; }
    var gone = goneHome(title);
    if (gone) { location.href = gone; return; }
    var spec = window.VEYORA_DEFS[title], key = itemKey(ci, title);
    var ctx = {
      title: title, hint: cats[ci].hint, help: (window.VEYORA_HELP || {})[title], spec: spec, key: key, canEdit: canEditCat(homeCat(ci, title)), db: db, company: company, hooks: hooks,
      customRoles: customRoleNames(),
      backLabel: cats[ci].title, value: company.settings ? company.settings[key] : undefined,
      onBack: function () { select(ci); },
      allSettings: function () { return company.settings || {}; }, saveKey: saveSetting, loadAudit: loadAudit,
      save: function (val) {
        if (spec.type === "company") {
          return db.from("companies").update(val).eq("id", company.id).select().single().then(function (r) { if (r.error) throw new Error(r.error.message); company = r.data; });
        }
        return saveSetting(key, val);
      }
    };
    viewId++; active = ci; openItem = n; renderMgmt();
    window.VeyoraEngine.render(els.panel, ctx);
  }

  els.panel.addEventListener("click", function (e) {
    var li = e.target.closest("[data-item]"); if (!li) return;
    var p = li.dataset.item.split(":"); itemPanel(Number(p[0]), Number(p[1]));
  });
  els.panel.addEventListener("keydown", function (e) {
    if (e.key !== "Enter") return; var li = e.target.closest("[data-item]"); if (li) li.click();
  });

  var viewId = 0;
  function cap(t) { return t === "hr" ? "HR" : t === "it" ? "IT" : t.charAt(0).toUpperCase() + t.slice(1); }

  function roleChoices(currentEnum, currentLabel) {
    var names = customRoleNames();
    if (currentLabel && names.indexOf(currentLabel) === -1) names.push(currentLabel);
    var html = roles.map(function (r) {
      return '<option value="' + r + '"' + (!currentLabel && r === currentEnum ? " selected" : "") + ">" + cap(r) + "</option>";
    }).join("");
    return html + names.map(function (n) {
      return '<option value="custom:' + esc(n) + '"' + (currentLabel === n ? " selected" : "") + ">" + esc(n) + "</option>";
    }).join("");
  }
  function rolePatch(value) {
    if (value.indexOf("custom:") === 0) return { role: "staff", role_label: value.slice(7) };
    return { role: value, role_label: null };
  }
  function loadMembers() {
    function q(cols) { return db.from("company_members").select(cols).eq("company_id", company.id).order("created_at"); }
    return q("user_id, role, role_label, active, created_at").then(function (r) {
      if (r.error && /role_label/.test(r.error.message || "")) {
        return q("user_id, role, active, created_at").then(function (r2) {
          (r2.data || []).forEach(function (m) { m.role_label = null; });
          return r2;
        });
      }
      return r;
    });
  }
  function loadInvites() {
    if (!isAdmin()) return Promise.resolve({ data: [] });
    function q(cols) {
      return db.from("company_invites").select(cols).eq("company_id", company.id).is("accepted_at", null).gt("expires_at", new Date().toISOString()).order("created_at", { ascending: false });
    }
    return q("id, email, role, role_label, token, expires_at").then(function (r) {
      if (r.error && /role_label/.test(r.error.message || "")) {
        return q("id, email, role, token, expires_at").then(function (r2) {
          (r2.data || []).forEach(function (inv) { inv.role_label = null; });
          return r2;
        });
      }
      return r;
    });
  }

  function usersPanel() {
    var v = ++viewId;
    els.panel.innerHTML = '<button type="button" class="back" data-cat="' + active + '">← Users &amp; Access Control</button><h2>User accounts</h2><p class="note">Everyone listed here belongs to ' + esc(company.name) + ' and can only see this company\'s data.</p><p class="msg">Loading…</p>';
    Promise.all([loadMembers(), loadInvites()]).then(function (res) {
      if (res[0].error) throw new Error(res[0].error.message);
      if (v !== viewId) return null;
      var members = res[0].data, invites = res[1].data || [];
      if (!members) return null;
      return db.from("profiles").select("id, full_name, email").in("id", members.map(function (m) { return m.user_id; })).then(function (p) {
        var byId = {}; (p.data || []).forEach(function (x) { byId[x.id] = x; });
        if (v === viewId) renderUsers(members, invites, byId);
      });
    }).catch(function (err) {
      if (v !== viewId) return;
      els.panel.innerHTML = '<h2>Users &amp; Access Control</h2><p class="msg err">' + esc(err.message) + '</p>';
    });
  }

  function inviteUrl(token) {
    return location.origin + location.pathname.replace(/[^/]*$/, "") + "index.html?invite=" + token;
  }

  function renderUsers(members, invites, byId) {
    var admin = isAdmin();
    var rows = members.map(function (m) {
      var p = byId[m.user_id] || {}, self = m.user_id === me, locked = !admin || m.role === "owner" || self;
      var name = p.full_name || (p.email || "").split("@")[0] || "Unknown";
      return '<li class="row" data-uid="' + m.user_id + '"><span class="av">' + esc(name.charAt(0).toUpperCase()) + '</span>' +
        '<span class="grow"><strong>' + esc(name) + (self ? " (you)" : "") + '</strong><small>' + esc(p.email || "") + '</small></span>' +
        (locked ? '<span class="tag">' + esc(m.role_label || cap(m.role)) + '</span>' :
          '<select data-act="role" aria-label="Role">' + roleChoices(m.role, m.role_label) + '</select>') +
        (locked ? '' : '<button type="button" class="sw" role="switch" data-act="active" aria-checked="' + m.active + '" aria-label="Active" title="' + (m.active ? "Active" : "Suspended") + '"></button>' +
          '<button type="button" class="ghost danger" data-act="remove">Remove</button>') +
        (locked && !m.active ? '<span class="tag">Suspended</span>' : '') + '</li>';
    }).join("");
    var inv = invites.map(function (i) {
      return '<li class="row" data-iid="' + i.id + '"><span class="grow"><strong>' + esc(i.email) + '</strong><small>' + esc(i.role_label || cap(i.role)) + ' · expires ' + new Date(i.expires_at).toLocaleDateString() + '</small></span>' +
        '<button type="button" class="ghost" data-act="copy" data-url="' + esc(inviteUrl(i.token)) + '">Copy link</button>' +
        '<button type="button" class="ghost danger" data-act="revoke">Revoke</button></li>';
    }).join("");
    els.panel.innerHTML =
      '<button type="button" class="back" data-cat="' + active + '">← Users &amp; Access Control</button><h2>User accounts</h2>' +
      '<p class="note">Everyone listed here belongs to ' + esc(company.name) + ' and can only see this company\'s data.</p>' +
      '<h3>User accounts <small>' + members.length + '</small></h3><ul class="rows" id="memberRows">' + rows + '</ul>' +
      (admin ? '<h3>Invite staff</h3><form id="inviteStaff" class="inv" novalidate>' +
        '<input id="inv_email" type="email" placeholder="staff@email.com" aria-label="Staff email" required>' +
        '<select id="inv_role" aria-label="Role">' + roleChoices("staff", null) + '</select>' +
        '<button class="save" type="submit">Create invite</button></form>' +
        '<p class="msg" id="usersMsg" role="status"></p>' +
        (inv ? '<h3>Pending invites</h3><ul class="rows">' + inv + '</ul>' : '') : '<p class="msg">Only owners and admins can manage staff.</p>') +
      '<h3>Roles &amp; permissions</h3><ul class="rows">' + ["owner"].concat(roles).map(function (r) {
        return '<li class="row"><span class="tag">' + cap(r) + '</span><span class="grow"><small>' + roleInfo[r] + '</small></span></li>';
      }).join("") + customRoleNames().map(function (n) {
        return '<li class="row"><span class="tag">' + esc(n) + '</span><span class="grow"><small>Custom role. Choose what it can do under Roles &amp; Permissions.</small></span></li>';
      }).join("") + '</ul>';
    var f = document.getElementById("inviteStaff");
    if (f) f.addEventListener("submit", createInvite);
  }

  function usersMsg(t, k) { var m = document.getElementById("usersMsg"); if (m) { m.textContent = t; m.className = "msg " + (k || ""); } }

  function createInvite(e) {
    e.preventDefault();
    var mail = document.getElementById("inv_email").value.trim().toLowerCase();
    var picked = rolePatch(document.getElementById("inv_role").value);
    if (!/^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(mail)) { usersMsg("Enter a valid email.", "err"); return; }
    var row = { company_id: company.id, email: mail, role: picked.role };
    if (picked.role_label) row.role_label = picked.role_label;
    db.from("company_invites").insert(row).select().single().then(function (r) {
      if (r.error) { usersMsg(/role_label/.test(r.error.message || "") ? "Apply database migration 0009, then assign this role." : r.error.message, "err"); return; }
      var url = inviteUrl(r.data.token);
      var done = function () { usersPanel(); setTimeout(function () { usersMsg("Invite link copied. Send it to " + mail + ".", "ok"); }, 400); };
      if (navigator.clipboard) navigator.clipboard.writeText(url).then(done, function () { usersPanel(); prompt("Copy this invite link", url); }); else { usersPanel(); prompt("Copy this invite link", url); }
    });
  }

  els.panel.addEventListener("change", function (e) {
    var el = e.target.closest('[data-act="role"]'); if (!el) return;
    var uid = el.closest("[data-uid]").dataset.uid;
    var patch = rolePatch(el.value);
    db.from("company_members").update(patch).eq("company_id", company.id).eq("user_id", uid).then(function (r) {
      if (r.error) alert(/role_label/.test(r.error.message || "") ? "Apply database migration 0009, then assign this role." : r.error.message);
    });
  });

  els.panel.addEventListener("click", function (e) {
    var b = e.target.closest("[data-act]"); if (!b || b.tagName === "SELECT") return;
    var row = b.closest("li"), act = b.dataset.act;
    if (act === "active") {
      var on = b.getAttribute("aria-checked") !== "true";
      db.from("company_members").update({ active: on }).eq("company_id", company.id).eq("user_id", row.dataset.uid).then(function (r) {
        if (r.error) alert(r.error.message); else b.setAttribute("aria-checked", on);
      });
    } else if (act === "remove") {
      if (!confirm("Remove this person from the company?")) return;
      db.from("company_members").delete().eq("company_id", company.id).eq("user_id", row.dataset.uid).then(function (r) {
        if (r.error) alert(r.error.message); else usersPanel();
      });
    } else if (act === "revoke") {
      db.from("company_invites").delete().eq("id", row.dataset.iid).then(function (r) {
        if (r.error) alert(r.error.message); else usersPanel();
      });
    } else if (act === "copy") {
      if (navigator.clipboard) navigator.clipboard.writeText(b.dataset.url).then(function () { b.textContent = "Copied"; });
      else prompt("Copy this invite link", b.dataset.url);
    }
  });

  function select(i) {
    viewId++;
    active = i; openItem = null; renderMgmt();
    if (i === 0) profilePanel(); else listPanel(i);
  }
  // Opens a setting here when this page shows its group; otherwise goes to the page that does.
  function findTitle(title) {
    var hit = null, away = null;
    cats.forEach(function (c, ci) { var n = c.items.indexOf(title); if (n > -1) { if (shown(ci)) { if (!hit) hit = [ci, n]; } else if (!away) away = [ci, n]; } });
    return hit ? { here: hit } : away ? { href: goneHome(title) || (catHref(away[0]) + "#open=" + encodeURIComponent(title)) } : null;
  }
  function openByTitle(title) {
    // Cursor 2026-10-23: old deep links for dept/titles → HR organization page.
    if (title === "Department Management" || title === "Job Titles & Positions" || title === "Designations" || title === "Crew Positions") {
      location.href = "hr.html#organization";
      return true;
    }
    var f = findTitle(title); if (!f) return false;
    if (f.here) { itemPanel(f.here[0], f.here[1]); return true; }
    location.href = f.href; return true;
  }

  document.addEventListener("click", function (e) {
    var b = e.target.closest("[data-cat]");
    if (b) { select(Number(b.dataset.cat)); window.scrollTo({ top: 0, behavior: "smooth" }); }
  });
  var auditBtn = document.querySelector("[data-audit]");
  if (auditBtn) auditBtn.addEventListener("click", function () { openByTitle("Audit Logs"); });
  els.mgmt.addEventListener("click", function (e) {
    var m = e.target.closest("[data-more]"); if (m) { e.preventDefault(); toggleMore(m); return; }
    var li = e.target.closest("[data-item]"); if (!li) return;
    var p = li.dataset.item.split(":"); itemPanel(Number(p[0]), Number(p[1]));
  });
  els.mgmt.addEventListener("keydown", function (e) {
    if (e.key !== "Enter" && e.key !== " ") return;
    var li = e.target.closest("[data-item]"); if (!li) return;
    e.preventDefault(); li.click();
  });

  document.getElementById("burger").addEventListener("click", function () {
    var side = document.getElementById("side");
    if (window.matchMedia("(max-width:900px)").matches) side.classList.toggle("open");
    else if (side.classList.contains("is-collapsed") && window.VeyoraShell && window.VeyoraShell.setNavCollapsed) window.VeyoraShell.setNavCollapsed(false);
    else side.classList.toggle("open");
  });
  document.getElementById("me").addEventListener("click", function (e) { e.stopPropagation(); var m = document.getElementById("menu"); m.hidden = !m.hidden; });
  document.addEventListener("click", function () { document.getElementById("menu").hidden = true; });
  document.getElementById("side").addEventListener("click", function (e) { if (e.target === e.currentTarget) e.currentTarget.classList.remove("open"); });
  document.getElementById("signOut").addEventListener("click", function () {
    db.auth.signOut().then(function () { location.replace("index.html"); });
  });

  renderMgmt(); renderPrefs();
  /* ---------- company loading, and the platform owner's company switcher ---------- */
  var VIEW_KEY = "veyora-view-company";
  var sw = document.getElementById("cswitch");
  var swBtn = document.getElementById("csBtn"), swPanel = document.getElementById("csPanel"), swSearch = document.getElementById("csSearch"), swList = document.getElementById("csList");
  var allCompanies = [];

  function showCompany(c, memberRole) {
    company = c;
    myRole = memberRole || "";
    active = 0;
    els.welcome.hidden = true;
    [].forEach.call(document.querySelectorAll(".company-note"), function (n) { n.remove(); });
    if (company.status !== "Active") {
      var n = document.createElement("div"); n.className = "locked company-note";
      n.textContent = isPlatform ? "This company is " + company.status.toLowerCase() + "." : company.status === "Pending" ? "Your company is awaiting approval by the VEYORA platform owner. Some features stay locked until then." : "Your company is suspended. Contact the VEYORA platform owner.";
      els.welcome.parentNode.insertBefore(n, els.welcome);
    }
    els.role.textContent = isPlatform && !memberRole ? "Platform owner" : cap(myRole);
    if (swBtn) swBtn.querySelector("span").textContent = company.name;
    if (window.VeyoraSub) window.VeyoraSub.watch(db, company.id, isAdmin());
    if (window.VeyoraBell) window.VeyoraBell.watch(db, company.id, company.settings);
    maintOk = false;
    db.rpc("is_company_maint", { cid: company.id }).then(function (r) { maintOk = r.data === true; });
    renderMgmt();
    select(inMod ? inMod.cats[0] : 0);
    if (window.VeyoraTip) window.VeyoraTip("settings", [
      "Pick an area from **Management settings** on the right, or type in **Search settings**.",
      "Each setting says what it is used for. **Changed** means it differs from the default; **Not changed** uses the standard value.",
      "Settings for parts of VEYORA that aren't built yet are folded under **Show more**, so you only see what works today."
    ]);
    // Deep links: settings.html#cat=<n> opens a group; settings.html#open=<setting title> opens that setting directly.
    deepLink();
  }
  function deepLink() {
    if (!company) return;
    var cm = /#cat=(\d+)$/.exec(location.hash);
    if (cm && cats[Number(cm[1])]) { if (shown(Number(cm[1]))) select(Number(cm[1])); else { location.replace(catHref(Number(cm[1]))); return; } }
    var m = /#open=(.+)$/.exec(location.hash);
    if (m) openByTitle(decodeURIComponent(m[1]));
  }
  window.addEventListener("hashchange", deepLink);

  function openCompany(id) {
    try { localStorage.setItem(VIEW_KEY, id); } catch (e) {}
    els.panel.innerHTML = '<p class="msg">Loading company…</p>';
    return Promise.all([
      db.from("companies").select("*").eq("id", id).single(),
      db.from("company_members").select("role").eq("company_id", id).eq("user_id", me).maybeSingle()
    ]).then(function (r) {
      if (r[0].error) throw new Error(r[0].error.message);
      showCompany(r[0].data, r[1].data && r[1].data.role);
    }).catch(function (err) {
      els.panel.innerHTML = '<h2>Could not load company</h2><p class="note">' + esc(err.message) + '</p>';
    });
  }

  function drawSwitchList() {
    var q = swSearch.value.trim().toLowerCase();
    var rows = allCompanies.filter(function (c) { return !q || (c.name + " " + c.code + " " + c.type + " " + c.status).toLowerCase().indexOf(q) > -1; });
    swList.innerHTML = rows.length ? rows.map(function (c) {
      return '<li role="option" tabindex="0" data-cid="' + c.id + '"' + (company && c.id === company.id ? ' aria-selected="true"' : "") + '><span class="grow"><strong>' + esc(c.name) + '</strong><small>' + esc(c.code) + ' · ' + esc(c.type) + '</small></span><span class="tag">' + esc(c.status) + '</span></li>';
    }).join("") : '<li class="cs-empty">No companies match.</li>';
  }
  function closeSwitch() { swPanel.hidden = true; swBtn.setAttribute("aria-expanded", "false"); }
  function openSwitch() { swPanel.hidden = false; swBtn.setAttribute("aria-expanded", "true"); swSearch.value = ""; drawSwitchList(); swSearch.focus(); }
  function pick(li) { if (!li || !li.dataset.cid) return; closeSwitch(); openCompany(li.dataset.cid); }

  if (sw) {
    swBtn.addEventListener("click", function (e) { e.stopPropagation(); if (swPanel.hidden) openSwitch(); else closeSwitch(); });
    swPanel.addEventListener("click", function (e) { e.stopPropagation(); pick(e.target.closest("[data-cid]")); });
    swSearch.addEventListener("input", drawSwitchList);
    swSearch.addEventListener("keydown", function (e) {
      if (e.key === "Enter") { e.preventDefault(); pick(swList.querySelector("[data-cid]")); }
      if (e.key === "ArrowDown") { var f = swList.querySelector("[data-cid]"); if (f) f.focus(); }
      if (e.key === "Escape") closeSwitch();
    });
    swList.addEventListener("keydown", function (e) {
      var li = e.target.closest("[data-cid]"); if (!li) return;
      if (e.key === "Enter") pick(li);
      if (e.key === "ArrowDown" && li.nextElementSibling && li.nextElementSibling.dataset.cid) li.nextElementSibling.focus();
      if (e.key === "ArrowUp") { if (li.previousElementSibling) li.previousElementSibling.focus(); else swSearch.focus(); }
      if (e.key === "Escape") { closeSwitch(); swBtn.focus(); }
    });
    document.addEventListener("click", closeSwitch);
  }

  function noCompany() {
    els.panel.innerHTML = '<h2>No company yet</h2><p class="note">Create a company from the sign-in page to get started.</p>';
  }

  db.auth.getSession().then(function (r) {
    var session = r.data.session;
    if (!session) { location.replace("index.html"); return; }
    me = session.user.id;
    var mail = session.user.email || "";
    var nm = (session.user.user_metadata && session.user.user_metadata.full_name) || mail.split("@")[0];
    els.name.textContent = nm;
    els.avatar.textContent = nm.split(/[\s._-]+/).filter(Boolean).slice(0, 2).map(function (s) { return s[0].toUpperCase(); }).join("") || "?";
    return db.from("platform_admins").select("user_id").then(function (a) {
      isPlatform = !!(a.data && a.data.length);
      if (isPlatform) {
        var l = document.createElement("button"); l.type = "button"; l.textContent = "Platform owner";
        l.addEventListener("click", function () { location.href = "platform.html"; });
        document.getElementById("menu").insertBefore(l, document.getElementById("signOut"));
        return db.from("companies").select("id, name, code, type, status").order("name").then(function (c) {
          if (c.error) throw new Error(c.error.message);
          allCompanies = c.data || [];
          sw.hidden = false;
          if (!allCompanies.length) { swBtn.querySelector("span").textContent = "No companies"; els.role.textContent = "Platform owner"; els.panel.innerHTML = '<h2>No companies yet</h2><p class="note">Companies appear here as they register.</p>'; return; }
          var stored = null; try { stored = localStorage.getItem(VIEW_KEY); } catch (e) {}
          var chosen = allCompanies.filter(function (x) { return x.id === stored; })[0];
          if (chosen) return openCompany(chosen.id);
          els.role.textContent = "Platform owner";
          els.panel.innerHTML = '<h2>Select a company</h2><p class="note">Search for a company in the menu at the top left to open its data.</p>';
          swBtn.querySelector("span").textContent = "Select a company";
          openSwitch();
        });
      }
      return db.from("company_members").select("role, companies(*)").eq("user_id", me).eq("active", true).order("created_at", { ascending: true }).limit(1).then(function (m) {
        if (m.error) throw new Error(m.error.message);
        if (!m.data.length) { noCompany(); return; }
        /* Cursor 2026-10-23: welcome deep-link opens company setup wizard. */
        var created = m.data[0].companies;
        if (/[?&]welcome=1/.test(location.search)) {
          var wiz = (created.settings && created.settings["0_setup_wizard"]) || {};
          if (!wiz.done) { location.replace("onboarding.html"); return; }
        }
        showCompany(created, m.data[0].role);
        if (/[?&]welcome=1/.test(location.search)) els.welcome.hidden = false;
      });
    });
  }).catch(function (err) {
    els.panel.innerHTML = '<h2>Could not load settings</h2><p class="note">' + esc(err.message) + '</p>';
  });
})();
