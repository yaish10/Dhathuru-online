/* Bank transfer slip reader: OCR in the browser (Tesseract.js), then rules tuned for Maldives Islamic Bank (MIB) and Bank of Maldives (BML) slips.
   read(file, onProgress) -> {fields, text}; check(fields, expected) -> [{key, level: pass|warn|fail, msg}].
   The same checks run again on the server in submit_payment_slip(); the browser result is only a convenience. */
(function () {
  var LIB = "https://cdn.jsdelivr.net/npm/tesseract.js@5.1.1/dist/tesseract.min.js";
  var libP = null, worker = null;
  function loadLib() {
    if (window.Tesseract) return Promise.resolve();
    if (!libP) libP = new Promise(function (ok, fail) {
      var s = document.createElement("script"); s.src = LIB; s.onload = ok; s.onerror = function () { libP = null; fail(new Error("Could not load the slip reader. Check your connection.")); };
      document.head.appendChild(s);
    });
    return libP;
  }
  function pad(n) { return n < 10 ? "0" + n : String(n); }

  /* ---------- image preparation: scale up, grey, flip dark slips to dark-on-light ---------- */
  function prepare(file) {
    return new Promise(function (ok, fail) {
      var url = URL.createObjectURL(file), img = new Image();
      img.onload = function () {
        var w = img.naturalWidth, h = img.naturalHeight, k = Math.max(1, Math.min(3, 1600 / w));
        var c = document.createElement("canvas"); c.width = Math.round(w * k); c.height = Math.round(h * k);
        var x = c.getContext("2d", { willReadFrequently: true }); x.fillStyle = "#fff"; x.fillRect(0, 0, c.width, c.height); x.drawImage(img, 0, 0, c.width, c.height);
        var d = x.getImageData(0, 0, c.width, c.height), p = d.data, i, sum = 0, n = p.length / 4;
        for (i = 0; i < p.length; i += 4) { var g = (p[i] * 0.299 + p[i + 1] * 0.587 + p[i + 2] * 0.114); p[i] = p[i + 1] = p[i + 2] = g; sum += g; }
        var dark = sum / n < 120;
        for (i = 0; i < p.length; i += 4) {
          var v = dark ? 255 - p[i] : p[i];
          v = v < 110 ? v * 0.55 : v > 200 ? 255 : v;   // a little contrast
          p[i] = p[i + 1] = p[i + 2] = v;
        }
        x.putImageData(d, 0, 0); URL.revokeObjectURL(url); ok({ canvas: c, dark: dark });
      };
      img.onerror = function () { URL.revokeObjectURL(url); fail(new Error("That file is not a readable image.")); };
      img.src = url;
    });
  }

  function ocr(canvas, onProgress) {
    return loadLib().then(function () {
      var p = worker ? Promise.resolve(worker) : window.Tesseract.createWorker("eng", 1, { logger: function (m) { if (onProgress && m.status === "recognizing text") onProgress(m.progress); } }).then(function (w) { worker = w; return w; });
      return p.then(function (w) { return w.setParameters({ tessedit_pageseg_mode: "6", preserve_interword_spaces: "1" }).then(function () { return w.recognize(canvas); }); });
    }).then(function (r) { return r.data.text || ""; });
  }

  /* ---------- text -> fields ---------- */
  function norm(s) { return String(s || "").replace(/[|¦]/g, "I").replace(/[ \t]+/g, " ").trim(); }
  function digitsFix(s) { return String(s).replace(/[Oo]/g, "0").replace(/[Il]/g, "1").replace(/\s+/g, ""); }
  function iso(y, mo, d, h, mi, s) { return y + "-" + pad(+mo) + "-" + pad(+d) + " " + pad(+h) + ":" + pad(+mi) + ":" + pad(+(s || 0)); }
  var LABEL = /^(from|to|bank|created date|status date|status|message|reference|transaction\s*(date|type|#)|processed date|remarks|amount|id\s*#?|date)\b/i;

  function findDate(lines) {
    var rx1 = /(\d{4})-(\d{2})-(\d{2})[ T]+(\d{1,2}):(\d{2})(?::(\d{2}))?/, rx2 = /(\d{1,2})\s*[\/.\-]\s*(\d{1,2})\s*[\/.\-]\s*(\d{4})[ ,T]+(\d{1,2}):(\d{2})(?::(\d{2}))?/;
    var order = lines.filter(function (l) { return /(created|transaction)\s*date/i.test(l); }).concat(lines.filter(function (l) { return /date/i.test(l); }), lines), i, m;
    for (i = 0; i < order.length; i++) {
      if ((m = rx1.exec(order[i]))) return iso(m[1], m[2], m[3], m[4], m[5], m[6]);
      if ((m = rx2.exec(order[i]))) return iso(m[3], m[2], m[1], m[4], m[5], m[6]);   // Bank of Maldives writes day/month/year
    }
    return "";
  }
  function section(lines, labelRx) {
    var i, out = [];
    for (i = 0; i < lines.length; i++) if (labelRx.test(lines[i])) break;
    if (i >= lines.length) return null;
    out.push(lines[i].replace(labelRx, "").trim());
    for (var j = i + 1; j < lines.length && j <= i + 2; j++) { if (LABEL.test(lines[j])) break; out.push(lines[j]); }
    return out.join(" ").trim();
  }
  function accountAndName(chunk) {
    if (!chunk) return { no: "", name: "" };
    var m = chunk.match(/[\dOoIl][\dOoIl ]{7,22}[\dOoIl]/), no = m ? digitsFix(m[0]) : "";
    var name = chunk.replace(m ? m[0] : "", "").replace(/[^A-Za-z.' \-]/g, " ").replace(/\s+/g, " ").replace(/(^| )[A-Za-z]( |$)/g, " ").trim();
    return { no: /^\d{8,}$/.test(no) ? no : "", name: name };
  }
  function parse(text) {
    var lines = String(text || "").split(/\r?\n/).map(norm).filter(Boolean), all, f = {};
    // The OCR sometimes splits a wide label ("To") into "T ... o" on two lines; put it back together.
    lines = lines.reduce(function (acc, l) { if (acc.length && /^o$/i.test(l) && /^T\s+\S/.test(acc[acc.length - 1])) acc[acc.length - 1] = "To " + acc[acc.length - 1].slice(1).trim(); else acc.push(l); return acc; }, []);
    all = lines.join("\n");
    f.bank = /islamic/i.test(all) ? "MIB" : /bank of maldives/i.test(all) ? "BML" : /favara|dhathuru/i.test(all) ? "MIB" : /BLAZ\w{6,}/i.test(all) ? "BML" : "";
    f.status = /(success|completed|successful)/i.test(all) ? "SUCCESS" : /(fail|reject|declin|unsuccess)/i.test(all) ? "FAILED" : "";
    // amount: the line that says Amount, else the first MVR figure
    var amtRx = /(?:MVR|USD|Rf\.?)\s*([\d,]+\.\d{2})|([\d,]+\.\d{2})\s*(MVR|USD)/i, m, cand = null;
    lines.forEach(function (l) { if (!cand && /^amount\b/i.test(l) && (m = amtRx.exec(l))) cand = m; });
    if (!cand) lines.forEach(function (l) { if (!cand && (m = amtRx.exec(l))) cand = m; });
    if (!cand && (m = all.match(/([\d,]+\.\d{2})/))) cand = [m[0], m[1]];
    if (cand) { f.amount = String(cand[1] || cand[2]).replace(/,/g, ""); f.currency = (/USD/i.test(cand[0]) ? "USD" : "MVR"); }
    // reference
    var ref = all.match(/\b(?:Id|Transaction|Trans|Txn)\s*(?:No\.?)?\s*#\s*[:\-]?\s*([0-9OoIl]{6,})/i) || all.match(/\bId\s*#?\s*[:\-]?\s*([0-9OoIl]{6,})/i) || all.match(/Reference\s*(?:No\.?)?\s*[:\-]?\s*([A-Z0-9]{8,})/i) || all.match(/\b(BLAZ[A-Z0-9]{8,})/);
    if (ref) f.reference_no = /^[0-9OoIl]+$/.test(ref[1]) ? digitsFix(ref[1]) : ref[1].toUpperCase();
    f.transaction_date = findDate(lines);
    // MIB to MIB slips say "Quick Transfer"; MIB to another bank goes over Favara and the slip names the receiving bank.
    var tt = all.match(/Transaction\s*Type\s+([A-Za-z ]{3,30})/i);
    f.transaction_type = /favara/i.test(all) ? "Favara Transfer" : tt ? tt[1].trim() : (f.bank === "BML" ? "BML Transfer" : "Transfer");
    var bl = lines.filter(function (l) { return /^bank\s+\S/i.test(l) && !/^bank of maldives/i.test(l); })[0];
    if (bl && f.bank === "MIB") { var v = bl.replace(/^bank\s+/i, ""); f.to_bank = /islamic|mib/i.test(v) ? "MIB" : /maldives|bml/i.test(v) ? "BML" : v.trim(); }
    var to = accountAndName(section(lines, /^to\b\s*/i)), from = accountAndName(section(lines, /^from\b\s*/i));
    f.to_account = to.no; f.to_name = to.name; f.from_account = from.no; f.from_name = from.name;
    if (!f.to_account) {   // no readable "To" block: take a long number that is not the sender's
      var nums = (all.match(/\b\d{9,20}\b/g) || []).filter(function (n) { return n !== f.from_account && n !== f.reference_no; });
      if (nums.length) f.to_account = nums[nums.length - 1];
    }
    return f;
  }

  /* ---------- checks (mirrors submit_payment_slip in 0114) ---------- */
  function maldivesNow() { return Date.now(); }
  function toMs(s) { var m = /^(\d{4})-(\d{2})-(\d{2}) (\d{2}):(\d{2}):(\d{2})$/.exec(s || ""); return m ? Date.UTC(+m[1], +m[2] - 1, +m[3], +m[4] - 5, +m[5], +m[6]) : null; }   // Maldives is UTC+5, no daylight saving
  function check(f, ex) {
    var out = [], a, b, d;
    function add(key, level, msg) { out.push({ key: key, level: level, msg: msg }); }
    if (!f.status) add("status", "warn", "Could not read the transfer status."); else if (/succ|compl/i.test(f.status)) add("status", "pass", "Transfer completed."); else add("status", "fail", "The slip does not show a completed transfer.");
    var amt = f.amount ? Number(f.amount) : null;
    if (amt == null || isNaN(amt)) add("amount", "warn", "Could not read the amount.");
    else if (amt + 0.005 < ex.amount) add("amount", "fail", "Slip amount " + amt.toFixed(2) + " is less than the plan price " + Number(ex.amount).toFixed(2) + ".");
    else if (f.currency && f.currency !== ex.currency) add("amount", "fail", "Slip currency is not " + ex.currency + ".");
    else add("amount", "pass", "Amount " + amt.toFixed(2) + " " + ex.currency + " matches the plan.");
    a = String(f.to_account || "").replace(/[^0-9A-Za-z]/g, "").toUpperCase(); b = String(ex.account_no || "").replace(/[^0-9A-Za-z]/g, "").toUpperCase();
    if (!a) add("account", "warn", "Could not read the receiving account.");
    else if (a === b) add("account", "pass", "Paid into " + ex.bank + " " + ex.account_no + ".");
    else { d = 0; for (var i = 0; i < Math.min(a.length, b.length); i++) if (a[i] !== b[i]) d++; if (a.length === b.length && d <= 1) add("account", "warn", "The receiving account is one character off " + ex.account_no + ". Check the slip."); else add("account", "fail", "The slip shows account " + f.to_account + ", not " + ex.account_no + "."); }
    var exBank = /islamic|mib/i.test(ex.bank || "") ? "MIB" : /maldives|bml/i.test(ex.bank || "") ? "BML" : "";
    if (f.to_bank && exBank && f.to_bank !== exBank) add("bank", "warn", "The slip says the money went to " + f.to_bank + ", but this account is at " + exBank + ".");
    var t = toMs(f.transaction_date), c = ex.createdAt ? new Date(ex.createdAt).getTime() : null;
    if (t == null) add("date", "warn", "Could not read the transfer date and time.");
    else if (c != null && t < c - 15 * 60000) add("date", "fail", "The transfer was made before this renewal was started.");
    else if (t > maldivesNow() + 15 * 60000) add("date", "fail", "The transfer time is in the future.");
    else add("date", "pass", "Transfer made after the renewal started.");
    if (!f.reference_no) add("reference", "warn", "Could not read the reference number."); else add("reference", "pass", "Reference " + f.reference_no + " read.");
    return out;
  }
  function verdict(checks) { return checks.some(function (c) { return c.level === "fail"; }) ? "rejected" : checks.some(function (c) { return c.level === "warn"; }) ? "review" : "verified"; }

  function read(file, onProgress) {
    return prepare(file).then(function (p) { return ocr(p.canvas, onProgress); }).then(function (text) { return { text: text, fields: parse(text) }; });
  }
  window.VeyoraSlip = { read: read, parse: parse, check: check, verdict: verdict };
})();
