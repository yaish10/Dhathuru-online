/* Finance → Ticket fares (finance.html#fares).
   Cursor 2026-11-01: rule-based prices per route. One-way amounts write to
   routes.fare / routes.meta.fares (what bookings already use). Return rules
   (same-day / next-day / later) live on routes.meta.journeys. */
(function () {
  var KIND = [
    { id: "one_way", label: "One-way ticket", blurb: "One trip. They do not come back.", hint: "One trip" },
    { id: "same_day", label: "Two-way, same day", blurb: "Go and come back today. One price for both trips.", hint: "Both trips today" },
    { id: "next_day", label: "Two-way, different day", blurb: "Come back on another day. Going and return are priced as two tickets.", hint: "Each ticket" },
    { id: "later", label: "Two-way, different day", blurb: "Come back on another day. Going and return are priced as two tickets.", hint: "Each ticket" }
  ];
  var DAYS = ["Mon", "Tue", "Wed", "Thu", "Fri", "Sat", "Sun"];

  function esc(t) { return window.VeyoraShell.esc(t); }
  function $(id) { return document.getElementById(id); }
  function icon(p) { return '<svg viewBox="0 0 24 24">' + p + "</svg>"; }
  var IC = {
    ticket: '<path d="M4 8h16v3a2 2 0 0 0 0 4v3H4v-3a2 2 0 0 0 0-4V8Z"/>',
    search: '<circle cx="11" cy="11" r="7"/><path d="m20 20-3.5-3.5"/>',
    plus: '<path d="M12 5v14M5 12h14"/>',
    check: '<path d="m5 12 5 5 9-10"/>',
    copy: '<rect x="8" y="8" width="12" height="12" rx="2"/><path d="M4 16V6a2 2 0 0 1 2-2h10"/>',
    out: '<path d="M4 12h16M14 6l6 6-6 6"/>',
    back: '<path d="M20 12H4M10 6l-6 6 6 6"/>'
  };

  function nid() { return "jr_" + Date.now().toString(36) + Math.random().toString(36).slice(2, 6); }

  function isoDay(d) {
    return d.getFullYear() + "-" + String(d.getMonth() + 1).padStart(2, "0") + "-" + String(d.getDate()).padStart(2, "0");
  }
  function addDays(iso, n) {
    var d = new Date(iso + "T12:00:00");
    d.setDate(d.getDate() + n);
    return isoDay(d);
  }
  function weekday(iso) {
    return DAYS[(new Date(iso + "T12:00:00").getDay() + 6) % 7];
  }

  function kindMeta(id) {
    return KIND.filter(function (k) { return k.id === id; })[0] || KIND[0];
  }

  function defaultJourneys() {
    return [
      { id: "same_day", name: "Back today", kind: "same_day", on: true, mode: "fixed", value: "", custom: false, days: [] },
      { id: "next_day", name: "Back tomorrow", kind: "next_day", on: true, mode: "fixed", value: "", custom: false, days: [] },
      { id: "later", name: "Back later", kind: "later", on: true, mode: "fixed", value: "", custom: false, days: [] }
    ];
  }

  function num(v, fallback) {
    if (v === "" || v == null) return fallback;
    var n = Number(v);
    return isFinite(n) ? n : fallback;
  }

  function normalizeJourney(j, fallbackKind) {
    var kind = (j && j.kind) || fallbackKind || "same_day";
    if (!kindMeta(kind) || kind === "one_way") kind = "same_day";
    var meta = kindMeta(kind);
    var days = [];
    if (j && Array.isArray(j.days)) {
      days = j.days.filter(function (d) { return DAYS.indexOf(d) > -1; });
    }
    var goValue = j && j.goValue !== "" && j.goValue != null ? num(j.goValue, "") : "";
    var backValue = j && j.backValue !== "" && j.backValue != null ? num(j.backValue, "") : "";
    var value = j && j.value !== "" && j.value != null ? num(j.value, "") : "";
    if ((kind === "next_day" || kind === "later") && goValue === "" && backValue === "" && value !== "" && num(value, 0) > 0) {
      var half = roundMoney(num(value, 0) / 2, 2);
      goValue = half;
      backValue = roundMoney(num(value, 0) - half, 2);
    }
    return {
      id: (j && j.id) || nid(),
      name: (j && j.name) || meta.label,
      kind: kind,
      on: !j || j.on !== false,
      mode: j && j.mode === "multiply" ? "multiply" : "fixed",
      value: value,
      goValue: goValue,
      backValue: backValue,
      custom: !!(j && j.custom),
      days: days
    };
  }

  function asCurrencyRule(j, adult) {
    if (!j || j.mode !== "multiply") return j;
    var m = num(j.value, 0);
    return {
      id: j.id,
      name: j.name,
      kind: j.kind,
      on: j.on,
      mode: "fixed",
      value: m > 0 && adult > 0 ? roundMoney(adult * m, 2) : "",
      goValue: j.goValue,
      backValue: j.backValue,
      custom: j.custom,
      days: j.days || []
    };
  }

  function journeysOf(route, adult) {
    var raw = route && route.meta && Array.isArray(route.meta.journeys) ? route.meta.journeys : [];
    var defs = defaultJourneys();
    var out = defs.map(function (d) {
      var found = null;
      raw.forEach(function (j) {
        if (j && !j.custom && j.kind === d.kind) found = j;
      });
      return asCurrencyRule(normalizeJourney(found || d, d.kind), adult);
    });
    raw.forEach(function (j) {
      if (j && j.custom) out.push(asCurrencyRule(normalizeJourney(j), adult));
    });
    return out;
  }

  function catsOf(company) {
    var saved = company && company.settings ? company.settings["7_passenger_categories"] : null;
    var spec = window.VEYORA_DEFS && window.VEYORA_DEFS["Passenger Categories"];
    var rows = Array.isArray(saved) ? saved : ((spec && spec.def) || ["Adult", "Child", "Infant", "Senior"]);
    var names = rows.map(function (r) {
      if (typeof r === "string") return r;
      if (r && r.active === false) return null;
      return r && r.name;
    }).filter(Boolean);
    return names.length ? names : ["Adult", "Child", "Infant"];
  }

  function baseCat(cats) {
    if (cats.indexOf("Adult") > -1) return "Adult";
    return cats[0] || "Adult";
  }

  function faresOf(route, cats) {
    var map = {};
    var stored = route && route.meta && route.meta.fares && typeof route.meta.fares === "object" ? route.meta.fares : {};
    cats.forEach(function (c) {
      if (stored[c] != null && stored[c] !== "") map[c] = stored[c];
    });
    var root = route && route.fare != null ? route.fare : "";
    var b = baseCat(cats);
    if ((map[b] == null || map[b] === "") && root !== "" && root != null) map[b] = root;
    return map;
  }

  function patchMeta(route, patch) {
    var meta = {};
    var src = route && route.meta;
    if (src && typeof src === "object" && !Array.isArray(src)) {
      Object.keys(src).forEach(function (k) { meta[k] = src[k]; });
    }
    Object.keys(patch).forEach(function (k) { meta[k] = patch[k]; });
    return meta;
  }

  function spanOf(go, back) {
    if (!back) return "one_way";
    var g = Date.parse(go + "T12:00:00");
    var b = Date.parse(back + "T12:00:00");
    if (!isFinite(g) || !isFinite(b)) return "one_way";
    var days = Math.round((b - g) / 86400000);
    if (days <= 0) return "same_day";
    if (days === 1) return "next_day";
    return "later";
  }

  function ruleMatches(rule, span, cat, go) {
    if (!rule || !rule.on) return false;
    if (rule.kind !== span) return false;
    if (rule.days && rule.days.length) {
      if (rule.days.indexOf(weekday(go)) < 0) return false;
    }
    return true;
  }

  function pickRule(journeys, span, cat, go) {
    if (span === "one_way") return null;
    var hits = (journeys || []).filter(function (r) { return ruleMatches(r, span, cat, go); });
    if (!hits.length) return null;
    hits.sort(function (a, b) {
      var sa = (a.days && a.days.length ? 2 : 0) + (a.custom ? 1 : 0);
      var sb = (b.days && b.days.length ? 2 : 0) + (b.custom ? 1 : 0);
      return sb - sa;
    });
    return hits[0];
  }

  function roundMoney(n, dec) {
    var f = Math.pow(10, dec);
    return Math.round((Number(n) || 0) * f) / f;
  }

  function quote(opts) {
    var cats = opts.cats || [];
    var cat = opts.category || baseCat(cats);
    var fares = opts.fares || {};
    var bcat = baseCat(cats);
    var adult = num(fares[bcat], num(opts.routeFare, 0));
    var oneWay = fares[cat] != null && fares[cat] !== "" ? num(fares[cat], adult) : adult;
    var go = opts.go || isoDay(new Date());
    var back = opts.back || "";
    var span = spanOf(go, back);
    var km = kindMeta(span);
    var dec = opts.dec != null ? opts.dec : 2;
    if (span === "one_way") {
      return {
        span: span,
        label: "One-way ticket",
        amount: roundMoney(oneWay, dec),
        oneWay: oneWay,
        rule: null,
        note: "They are not coming back. Charge the one-way price only."
      };
    }
    var rule = pickRule(opts.journeys || [], span, cat, go);
    var two = roundMoney(oneWay * 2, dec);
    var moneyName = opts.currency || "MVR";
    var ratio = adult ? oneWay / adult : 1;
    if (span === "next_day" || span === "later") {
      var splitRule = rule || pickRule(opts.journeys || [], span === "next_day" ? "later" : "next_day", cat, go);
      var goAmt = splitRule ? num(splitRule.goValue, 0) : 0;
      var backAmt = splitRule ? num(splitRule.backValue, 0) : 0;
      if (splitRule && splitRule.on !== false && (goAmt > 0 || backAmt > 0)) {
        goAmt = roundMoney(goAmt * ratio, dec);
        backAmt = roundMoney(backAmt * ratio, dec);
        return {
          span: span,
          label: "Two-way, different day",
          amount: roundMoney(goAmt + backAmt, dec),
          goAmount: goAmt,
          backAmount: backAmt,
          split: true,
          oneWay: oneWay,
          rule: splitRule,
          note: "Going ticket " + goAmt + " " + moneyName + " · return ticket " + backAmt + " " + moneyName + "."
        };
      }
    }
    if (!rule) {
      return { span: span, label: km.label, amount: two, oneWay: oneWay, rule: null, fallback: true, note: "No two-way price typed yet, so this is two one-way tickets." };
    }
    var amount;
    var note;
    if (rule.mode === "fixed") {
      var fixedAdult = num(rule.value, 0);
      if (!(fixedAdult > 0)) {
        return { span: span, label: rule.name || km.label, amount: two, oneWay: oneWay, rule: rule, fallback: true, note: "Type the two-way price in " + moneyName + ". Until then this is two one-way tickets." };
      }
      amount = roundMoney(fixedAdult * ratio, dec);
      note = span === "same_day"
        ? "Same-day two-way in " + moneyName + " for both trips together" + (cat !== bcat ? " (from the " + bcat + " price)" : "") + "."
        : "Two-way in " + moneyName + " for going and coming back" + (cat !== bcat ? " (from the " + bcat + " price)" : "") + ".";
    } else {
      var mult = num(rule.value, 0);
      if (!(mult > 0)) {
        return { span: span, label: rule.name || km.label, amount: two, oneWay: oneWay, rule: rule, fallback: true, note: "Type the two-way price in " + moneyName + ". Until then this is two one-way tickets." };
      }
      amount = roundMoney(oneWay * mult, dec);
      note = "Two-way in " + moneyName + " for going and coming back.";
    }
    return { span: span, label: rule.name || km.label, amount: amount, oneWay: oneWay, rule: rule, note: note };
  }

  function journeyArt(kind) {
    if (kind === "same_day") {
      return '<span class="ff-art same" aria-hidden="true">' +
        '<svg viewBox="0 0 64 40"><circle cx="32" cy="14" r="8"/><path d="M8 30h18M42 30h14"/><path d="M20 30c4-8 8-8 12 0M32 30c4-8 8-8 12 0"/><path d="m24 26 2 4-4 0M44 26l-2 4 4 0"/></svg>' +
        "</span>";
    }
    if (kind === "next_day") {
      return '<span class="ff-art next" aria-hidden="true">' +
        '<svg viewBox="0 0 64 40"><circle cx="18" cy="14" r="7"/><path d="M42 10c4 1 8 5 8 10 0 6-5 10-10 10-3 0-6-1-8-3 4 0 8-3 8-8 0-3-1-6-4-8z"/><path d="M8 32h16l4-6 4 6h16"/></svg>' +
        "</span>";
    }
    return '<span class="ff-art later" aria-hidden="true">' +
      '<svg viewBox="0 0 64 40"><rect x="8" y="10" width="20" height="22" rx="3"/><path d="M8 16h20M14 8v4M22 8v4"/><rect x="36" y="10" width="20" height="22" rx="3"/><path d="M36 16h20M42 8v4M50 8v4"/><path d="M30 21h6"/></svg>' +
      "</span>";
  }

  window.VeyoraFinanceFares = {
    quote: quote,
    journeysOf: journeysOf,
    faresOf: faresOf,
    render: function (ctx) {
      var db = ctx.db, company = ctx.company, canEdit = ctx.canEdit;
      var host = ctx.host;
      var money = ctx.money || function (n) { return String(n); };
      var cats = catsOf(company);
      var bcat = baseCat(cats);
      var dec = 2;
      try {
        var bc = company && company.settings && company.settings["9_base_currency"];
        if (bc && Number(bc.decimals) >= 0) dec = Math.min(4, Number(bc.decimals));
      } catch (e) { /* keep 2 */ }
      var cur = "MVR";
      try {
        cur = (company.settings && company.settings["9_base_currency"] && company.settings["9_base_currency"].base) || company.currency || "MVR";
      } catch (e2) { /* keep MVR */ }

      var routes = [];
      var selectedId = ctx.routeId || "";
      var q = "";
      var dirty = false;
      var draft = null;
      var toastTimer = null;

      function toast(msg, ok) {
        var el = $("ffToast");
        if (!el) return;
        el.textContent = msg;
        el.className = "ff-toast " + (ok ? "ok" : "err");
        el.hidden = false;
        clearTimeout(toastTimer);
        toastTimer = setTimeout(function () { el.hidden = true; }, 2800);
      }

      function selected() {
        return routes.filter(function (r) { return r.id === selectedId; })[0] || routes[0] || null;
      }

      function ensureDraft(route) {
        if (draft && draft.routeId === route.id) return draft;
        var fares = faresOf(route, cats);
        var adult = num(fares[bcat], num(route.fare, 0));
        draft = {
          routeId: route.id,
          fares: fares,
          journeys: journeysOf(route, adult),
          tryCat: bcat,
          tryGo: isoDay(new Date()),
          tryBack: ""
        };
        var n = null, l = null;
        draft.journeys.forEach(function (j) {
          if (!j.custom && j.kind === "next_day") n = j;
          if (!j.custom && j.kind === "later") l = j;
        });
        if (n && l && !(num(n.goValue, 0) > 0 || num(n.backValue, 0) > 0) && (num(l.goValue, 0) > 0 || num(l.backValue, 0) > 0)) {
          n.goValue = l.goValue;
          n.backValue = l.backValue;
        }
        dirty = false;
        return draft;
      }

      function routeLabel(r) {
        return (r.origin && r.destination) ? (r.origin + " → " + r.destination) : (r.name || "Route");
      }

      function currentQuote() {
        var route = selected();
        if (!route || !draft) return null;
        return quote({
          cats: cats,
          category: draft.tryCat,
          fares: draft.fares,
          journeys: draft.journeys,
          routeFare: route.fare,
          go: draft.tryGo,
          back: draft.tryBack,
          dec: dec,
          currency: cur
        });
      }

      function paintQuote() {
        var box = $("ffQuote");
        if (!box) return;
        var qte = currentQuote();
        var route = selected();
        if (!qte || !route) { box.innerHTML = ""; return; }
        box.innerHTML =
          '<p class="ff-quote-kicker">' + esc(qte.label) + "</p>" +
          "<strong>" + esc(money(qte.amount)) + "</strong>" +
          (qte.split
            ? "<small>Going " + esc(money(qte.goAmount)) + " · Return " + esc(money(qte.backAmount)) + "</small>"
            : "<small>" + esc(draft.tryCat) + " · " + esc(routeLabel(route)) + "</small>") +
          '<p class="ff-quote-note">' + esc(qte.note) + "</p>" +
          (qte.span !== "one_way" && qte.fallback ? '<p class="ff-quote-warn">Type the two-way prices above, or this stays two one-way tickets.</p>' : "");
      }

      function builtJourney(kind) {
        var found = null;
        (draft.journeys || []).forEach(function (j) { if (!j.custom && j.kind === kind) found = j; });
        return found;
      }

      function syncDiffDay() {
        var n = builtJourney("next_day"), l = builtJourney("later");
        if (n && l) {
          l.goValue = n.goValue;
          l.backValue = n.backValue;
          l.on = n.on;
          l.value = roundMoney(num(n.goValue, 0) + num(n.backValue, 0), dec);
          n.value = l.value;
        }
      }

      function paintCardPreviews() {
        if (!draft) return;
        var same = builtJourney("same_day");
        var diff = builtJourney("next_day");
        var go = draft.tryGo || isoDay(new Date());
        var sameEl = host.querySelector("[data-same-preview]");
        var diffEl = host.querySelector("[data-diff-preview]");
        if (sameEl) {
          if (!same || !same.on) sameEl.textContent = "Not used";
          else if (!(num(same.value, 0) > 0)) sameEl.textContent = "Type the same-day two-way price in " + cur;
          else sameEl.textContent = bcat + " pays " + money(num(same.value, 0)) + " for both trips today";
        }
        if (diffEl) {
          var g = diff ? num(diff.goValue, 0) : 0, b = diff ? num(diff.backValue, 0) : 0;
          if (!diff || !diff.on) diffEl.textContent = "Not used";
          else if (!(g > 0 || b > 0)) diffEl.textContent = "Type the going ticket and the return ticket in " + cur;
          else diffEl.textContent = "Going " + money(g) + " · Return " + money(b) + " · Total " + money(g + b);
        }
      }

      function sideHtml() {
        var list = routes.filter(function (r) {
          if (!q) return true;
          var hay = (r.name + " " + r.origin + " " + r.destination + " " + (r.code || "")).toLowerCase();
          return hay.indexOf(q.toLowerCase()) > -1;
        });
        return '<aside class="ff-side">' +
          '<div class="ff-search">' + icon(IC.search) +
            '<input type="search" id="ffQ" placeholder="Search routes" value="' + esc(q) + '" aria-label="Search routes">' +
          "</div>" +
          (list.length
            ? '<div class="ff-routes" role="list">' + list.map(function (r) {
                var on = r.id === selectedId;
                var adult = faresOf(r, cats)[bcat];
                var hint = adult != null && adult !== "" ? money(adult) : "No price yet";
                return '<button type="button" class="ff-route' + (on ? " on" : "") + '" data-route="' + esc(r.id) + '" role="listitem">' +
                  "<strong>" + esc(routeLabel(r)) + "</strong>" +
                  "<small>" + esc(r.name !== routeLabel(r) ? r.name : hint) + (r.code ? " · " + esc(r.code) : "") + "</small>" +
                "</button>";
              }).join("") + "</div>"
            : '<p class="ff-empty-side">' + (routes.length ? "No routes match." : "No routes yet.") + "</p>") +
        "</aside>";
      }

      function priceTiles() {
        return '<div class="ff-prices">' + cats.map(function (c) {
          var v = draft.fares[c];
          var shown = v == null || v === "" ? "" : String(v);
          return '<label class="ff-price">' +
            "<span>" + esc(c) + "</span>" +
            '<input data-cat="' + esc(c) + '" type="number" min="0" step="0.01" inputmode="decimal" placeholder="—" value="' + esc(shown) + '"' + (canEdit ? "" : " disabled") + ">" +
            "<small>" + esc(cur) + " · one trip" + (c === bcat ? " · base" : "") + "</small>" +
          "</label>";
        }).join("") + "</div>";
      }

      function moneyField(id, val, hint) {
        return '<label class="ff-val">' +
          '<span class="ff-cur">' + esc(cur) + "</span>" +
          '<input id="' + id + '" type="number" min="0" step="0.01" inputmode="decimal" placeholder="0" value="' + esc(val === "" || val == null ? "" : String(val)) + '"' + (canEdit ? "" : " disabled") + ">" +
          "<span>" + esc(hint) + "</span>" +
        "</label>";
      }

      function tryHtml() {
        var span = spanOf(draft.tryGo, draft.tryBack);
        function chip(id, label) {
          var on = (!draft.tryBack && id === "one_way") || (draft.tryBack && (id === "same_day" ? span === "same_day" : span !== "same_day"));
          return '<button type="button" class="ff-chip' + (on ? " on" : "") + '" data-try="' + id + '">' + esc(label) + "</button>";
        }
        var goingOnly = !draft.tryBack;
        return '<div class="ff-try-grid">' +
          '<div class="ff-try-form">' +
            '<div class="ff-chips" role="group" aria-label="What kind of ticket">' +
              chip("one_way", "1. One-way ticket") +
              chip("same_day", "2. Two-way, same day") +
              chip("next_day", "3. Two-way, different day") +
            "</div>" +
            '<div class="ff-try-fields">' +
              '<label>Passenger<input list="ffCats" id="ffTryCat" value="' + esc(draft.tryCat) + '"></label>' +
              '<datalist id="ffCats">' + cats.map(function (c) { return '<option value="' + esc(c) + '">'; }).join("") + "</datalist>" +
              '<label>Going date<input type="date" id="ffTryGo" value="' + esc(draft.tryGo) + '"></label>' +
              (goingOnly
                ? '<label>Coming back<input type="text" value="Not coming back" disabled></label>'
                : '<label>Coming back<input type="date" id="ffTryBack" value="' + esc(draft.tryBack) + '"></label>') +
            "</div>" +
            '<p class="ff-try-hint">' + (goingOnly
              ? "Uses the one-way ticket price."
              : (span === "same_day"
                ? "Uses the same-day two-way price (both trips together)."
                : "Uses the going ticket plus the return ticket.")) + "</p>" +
          "</div>" +
          '<div class="ff-quote' + (goingOnly ? " one" : (span === "same_day" ? "" : " split")) + '" id="ffQuote"></div>' +
        "</div>";
      }

      function editorHtml(route) {
        ensureDraft(route);
        syncDiffDay();
        var trySpan = spanOf(draft.tryGo, draft.tryBack);
        var same = builtJourney("same_day") || { on: true, value: "" };
        var diff = builtJourney("next_day") || { on: true, goValue: "", backValue: "" };
        return '<div class="ff-editor">' +
          '<header class="ff-route-h">' +
            "<div><p class=\"ff-kicker\">" + esc(route.code || "Route") + "</p>" +
              "<h2>" + esc(routeLabel(route)) + "</h2></div>" +
            (canEdit
              ? '<div class="ff-route-acts">' +
                  '<button type="button" class="ghost" id="ffCopy">' + icon(IC.copy) + " Copy these prices to all routes</button>" +
                  '<button type="button" class="primary-btn" id="ffSave">' + icon(IC.check) + (dirty ? " Save route" : " Saved") + "</button>" +
                "</div>"
              : "") +
          "</header>" +
          '<section class="ff-card ff-board' + (trySpan === "one_way" ? " lit" : "") + '">' +
            '<div class="ff-board-h">' +
              '<span class="ff-num">1</span>' +
              '<div><h3>Price for one-way ticket</h3><p>One person, one trip. They do not come back. Leave a type blank to use the ' + esc(bcat) + " price.</p></div>" +
            "</div>" +
            priceTiles() +
          "</section>" +
          '<section class="ff-card ff-board' + (trySpan === "same_day" ? " lit" : "") + (same.on ? "" : " dim") + '">' +
            '<div class="ff-board-h">' +
              '<span class="ff-num">2</span>' +
              '<div><h3>Price for two-way (if same day)</h3><p>Go and come back <em>today</em>. One price in ' + esc(cur) + " for both trips together.</p></div>" +
              '<label class="ff-switch" title="Use this price"><input type="checkbox" id="ffSameOn"' + (same.on ? " checked" : "") + (canEdit ? "" : " disabled") + "><i></i></label>" +
            "</div>" +
            moneyField("ffSameVal", same.value, "both trips today") +
            '<p class="ff-rule-preview" data-same-preview></p>' +
          "</section>" +
          '<section class="ff-card ff-board' + (trySpan !== "one_way" && trySpan !== "same_day" ? " lit" : "") + (diff.on ? "" : " dim") + '">' +
            '<div class="ff-board-h">' +
              '<span class="ff-num">3</span>' +
              '<div><h3>Price for two-way ticket (different day)</h3><p>Come back tomorrow or later. Set a price for <em>each</em> ticket — going and return.</p></div>' +
              '<label class="ff-switch" title="Use this price"><input type="checkbox" id="ffDiffOn"' + (diff.on ? " checked" : "") + (canEdit ? "" : " disabled") + "><i></i></label>" +
            "</div>" +
            '<div class="ff-split">' +
              '<div class="ff-split-col">' +
                "<span>Going ticket</span>" +
                moneyField("ffDiffGo", diff.goValue, "this trip") +
              "</div>" +
              '<div class="ff-split-col">' +
                "<span>Return ticket</span>" +
                moneyField("ffDiffBack", diff.backValue, "return trip") +
              "</div>" +
            "</div>" +
            '<p class="ff-rule-preview" data-diff-preview></p>' +
          "</section>" +
          '<section class="ff-card ff-try-card">' +
            '<div class="ff-card-h"><div><h3>Check a ticket</h3><p>See which of the three prices will be charged.</p></div></div>' +
            tryHtml() +
          "</section>" +
        "</div>";
      }

      function emptyHtml() {
        return '<div class="ff-blank">' +
          '<span class="ff-blank-ic">' + icon(IC.ticket) + "</span>" +
          "<h2>" + (routes.length ? "Choose a route" : "No routes yet") + "</h2>" +
          "<p>" + (routes.length
            ? "Pick a route on the left to set one-way, same-day two-way, and different-day ticket prices."
            : 'Add a route in <a href="schedules.html">Schedules</a> first, then come back here to price it.') + "</p>" +
        "</div>";
      }

      function paint() {
        var route = selected();
        if (route) selectedId = route.id;
        host.innerHTML =
          '<div class="ff"><div id="ffToast" class="ff-toast" hidden></div>' +
            '<div class="ff-layout">' + sideHtml() +
              '<div class="ff-main">' + (route ? editorHtml(route) : emptyHtml()) + "</div>" +
            "</div></div>";
        bind();
        paintQuote();
        paintCardPreviews();
        markSave();
      }

      function markSave() {
        var btn = $("ffSave");
        if (!btn) return;
        btn.classList.toggle("is-dirty", dirty);
        btn.innerHTML = icon(IC.check) + (dirty ? " Save route" : " Saved");
      }

      function findJourney(id) {
        var found = null;
        draft.journeys.forEach(function (j) { if (j.id === id) found = j; });
        return found;
      }

      function refreshSide(keepFocus) {
        var aside = host.querySelector(".ff-side");
        if (!aside) return;
        var caret = keepFocus && $("ffQ") ? $("ffQ").selectionStart : null;
        var wrap = document.createElement("div");
        wrap.innerHTML = sideHtml();
        aside.replaceWith(wrap.firstChild);
        bindNav();
        if (keepFocus && $("ffQ")) {
          $("ffQ").focus();
          try { if (caret != null) $("ffQ").setSelectionRange(caret, caret); } catch (e) { /* ignore */ }
        }
      }

      function bindNav() {
        var search = $("ffQ");
        if (search) {
          search.addEventListener("input", function () {
            q = search.value;
            refreshSide(true);
          });
        }
        bindSide();
      }

      function bind() {
        bindNav();
        if (!draft) return;

        [].forEach.call(host.querySelectorAll("[data-cat]"), function (inp) {
          inp.addEventListener("input", function () {
            draft.fares[inp.getAttribute("data-cat")] = inp.value;
            dirty = true;
            markSave();
            paintQuote();
            paintCardPreviews();
          });
        });

        function touch() { dirty = true; markSave(); paintQuote(); paintCardPreviews(); }
        var same = builtJourney("same_day");
        var diff = builtJourney("next_day");
        if ($("ffSameOn") && same) $("ffSameOn").addEventListener("change", function () { same.on = $("ffSameOn").checked; touch(); });
        if ($("ffSameVal") && same) $("ffSameVal").addEventListener("input", function () {
          same.value = $("ffSameVal").value === "" ? "" : num($("ffSameVal").value, "");
          touch();
        });
        if ($("ffDiffOn") && diff) $("ffDiffOn").addEventListener("change", function () {
          diff.on = $("ffDiffOn").checked;
          syncDiffDay();
          touch();
        });
        if ($("ffDiffGo") && diff) $("ffDiffGo").addEventListener("input", function () {
          diff.goValue = $("ffDiffGo").value === "" ? "" : num($("ffDiffGo").value, "");
          syncDiffDay();
          touch();
        });
        if ($("ffDiffBack") && diff) $("ffDiffBack").addEventListener("input", function () {
          diff.backValue = $("ffDiffBack").value === "" ? "" : num($("ffDiffBack").value, "");
          syncDiffDay();
          touch();
        });

        [].forEach.call(host.querySelectorAll("[data-try]"), function (b) {
          b.addEventListener("click", function () {
            var k = b.getAttribute("data-try");
            if (k === "one_way") {
              draft.tryBack = "";
            } else if (k === "same_day") {
              draft.tryBack = draft.tryGo;
            } else if (k === "next_day") {
              draft.tryBack = addDays(draft.tryGo, 1);
            } else {
              draft.tryBack = addDays(draft.tryGo, 1);
            }
            paint();
          });
        });
        if ($("ffTryCat")) $("ffTryCat").addEventListener("input", function () {
          draft.tryCat = $("ffTryCat").value || bcat;
          paintQuote();
        });
        if ($("ffTryGo")) $("ffTryGo").addEventListener("change", function () {
          draft.tryGo = $("ffTryGo").value || isoDay(new Date());
          if (draft.tryBack && draft.tryBack < draft.tryGo) draft.tryBack = draft.tryGo;
          paint();
        });
        if ($("ffTryBack")) $("ffTryBack").addEventListener("change", function () {
          draft.tryBack = $("ffTryBack").value || "";
          paint();
        });

        if ($("ffSave")) $("ffSave").onclick = function () { saveRoute(false); };
        if ($("ffCopy")) $("ffCopy").onclick = function () { saveRoute(true); };
      }

      function bindSide() {
        [].forEach.call(host.querySelectorAll("[data-route]"), function (b) {
          b.addEventListener("click", function () {
            var id = b.getAttribute("data-route");
            if (id === selectedId) return;
            if (dirty && !window.confirm("This route has unsaved prices. Leave without saving?")) return;
            selectedId = id;
            draft = null;
            if (location.hash.indexOf("#fares") === 0) {
              var next = "#fares/" + id;
              if (location.hash !== next) location.hash = next;
              else paint();
            } else paint();
          });
        });
      }

      function cleanFares() {
        var out = {};
        cats.forEach(function (c) {
          var v = draft.fares[c];
          if (v === "" || v == null) return;
          var n = Number(v);
          if (!isFinite(n) || n < 0) throw new Error("Check the " + c + " price.");
          out[c] = roundMoney(n, dec);
        });
        return out;
      }

      function cleanJourneys() {
        syncDiffDay();
        return draft.journeys.filter(function (j) { return !j.custom; }).map(function (j) {
          var go = j.goValue === "" || j.goValue == null ? 0 : Number(j.goValue);
          var back = j.backValue === "" || j.backValue == null ? 0 : Number(j.backValue);
          var raw = j.value;
          var v = raw === "" || raw == null ? 0 : Number(raw);
          if (j.kind === "next_day" || j.kind === "later") {
            if (!isFinite(go) || go < 0 || !isFinite(back) || back < 0) throw new Error("Check the going and return ticket prices.");
            v = roundMoney(go + back, dec);
          } else if (!isFinite(v) || v < 0) {
            throw new Error("Check the number on “" + (j.name || kindMeta(j.kind).label) + "”.");
          }
          return {
            id: j.id,
            name: String(j.name || kindMeta(j.kind).label).slice(0, 40),
            kind: j.kind,
            on: !!j.on,
            mode: "fixed",
            value: roundMoney(v, dec),
            goValue: (j.kind === "next_day" || j.kind === "later") ? roundMoney(go, dec) : undefined,
            backValue: (j.kind === "next_day" || j.kind === "later") ? roundMoney(back, dec) : undefined,
            custom: false,
            days: (j.days || []).slice()
          };
        }).map(function (j) {
          if (j.goValue == null) delete j.goValue;
          if (j.backValue == null) delete j.backValue;
          return j;
        });
      }

      function writeRoute(route, fares, journeys) {
        var meta = patchMeta(route, { fares: fares, journeys: journeys });
        var adult = fares[bcat];
        var payload = { meta: meta, fare: adult != null ? adult : null };
        return db.from("routes").update(payload).eq("id", route.id).eq("company_id", company.id).then(function (r) {
          if (r.error) throw new Error(r.error.message);
          route.meta = meta;
          route.fare = payload.fare;
        });
      }

      function saveRoute(allRoutes) {
        var route = selected();
        if (!route || !canEdit) return;
        var btn = $("ffSave");
        if (btn) btn.disabled = true;
        var fares, journeys;
        try {
          fares = cleanFares();
          journeys = cleanJourneys();
        } catch (err) {
          toast(err.message, false);
          if (btn) btn.disabled = false;
          return;
        }
        var jobs = [writeRoute(route, fares, journeys)];
        if (allRoutes) {
          if (!window.confirm("Copy these two-way prices to every route? One-way prices on other routes stay as they are.")) {
            if (btn) btn.disabled = false;
            return;
          }
          routes.forEach(function (r) {
            if (r.id === route.id) return;
            jobs.push(writeRoute(r, faresOf(r, cats), journeys));
          });
        }
        Promise.all(jobs).then(function () {
          dirty = false;
          draft.fares = fares;
          draft.journeys = journeys;
          toast(allRoutes ? "Two-way prices copied to all routes." : "Route prices saved.", true);
          if (btn) btn.disabled = false;
          markSave();
          paintQuote();
          paintCardPreviews();
        }).catch(function (e) {
          toast(e.message || "Could not save.", false);
          if (btn) btn.disabled = false;
        });
      }

      host.innerHTML = '<div class="ff"><p class="msg">Loading routes…</p></div>';
      db.from("routes").select("id,name,code,origin,destination,fare,active,meta").eq("company_id", company.id).eq("active", true).order("name")
        .then(function (r) {
          if (r.error) throw new Error(r.error.message);
          routes = r.data || [];
          if (selectedId && !routes.some(function (x) { return x.id === selectedId; })) selectedId = "";
          if (!selectedId && routes[0]) selectedId = routes[0].id;
          paint();
        })
        .catch(function (e) {
          host.innerHTML = '<section class="fin-card"><h2>Ticket fares</h2><p class="note">' + esc(e.message) + "</p></section>";
        });
    }
  };
})();
