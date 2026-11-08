/* Platform → SMS (Message Owl). Settings live in platform_settings.config.sms; the API key is NOT here, it is a secret on the send-sms Edge Function. */
(function () {
  var db = window.veyoraDb, root = null;
  if (!db) return;
  function esc(t) { return String(t == null ? "" : t).replace(/[&<>"']/g, function (c) { return { "&": "&amp;", "<": "&lt;", ">": "&gt;", '"': "&quot;", "'": "&#39;" }[c]; }); }
  var DEFAULTS = {
    confirmed_prepaid: "Your booking ({ref}) for {route} on {date} at {time} has been confirmed and payment has been received.{link}",
    confirmed_cash: "Your booking ({ref}) for {route} on {date} at {time} has been confirmed. You may pay in cash before the trip departs.{link}",
    rescheduled: "Your trip on {old_date} has been rescheduled. Your booking ({ref}) is now for {route} on {date} at {time}.{link}",
    cancelled: "Your booking ({ref}) for {route} on {date} has been cancelled.{link}"
  };
  var LABELS = { confirmed_prepaid: "Booking added and already paid", confirmed_cash: "Booking added, to pay in cash", rescheduled: "Trip rescheduled", cancelled: "Booking cancelled" };
  var newSecret = "";
  function randSecret() { var a = new Uint8Array(24); crypto.getRandomValues(a); return [].map.call(a, function (b) { return b.toString(16).padStart(2, "0"); }).join(""); }
  function when(i) { return i ? new Date(i).toLocaleString("en-GB", { day: "numeric", month: "short", hour: "2-digit", minute: "2-digit" }) : ""; }

  function load() {
    root.innerHTML = '<h2>SMS to customers</h2><p class="msg">Loading…</p>';
    Promise.all([db.rpc("platform_sms_settings"), db.rpc("platform_sms_log", { p_limit: 30 }), db.rpc("platform_sms_senders")]).then(function (r) {
      if (!root || !document.body.contains(root)) return;
      if (r[0].error) { root.innerHTML = '<h2>SMS to customers</h2><p class="msg err">' + esc(r[0].error.message) + '<br>Run migration 0116 first.</p>'; return; }
      var c = r[0].data || {}, t = c.templates || {}, log = r[1].data || [], senders = (r[2] && r[2].data) || [], ref = location.origin;
      root.innerHTML = '<h2>SMS to customers</h2><p class="note">When a booking is added, cancelled or its trip is rescheduled, the customer gets a text through your SMS provider. A failed text never blocks a booking.</p>' +
        '<label class="lk-auto"><input type="checkbox" id="smsOn"' + (c.enabled === true || c.enabled === "true" ? " checked" : "") + '> Send SMS to customers <small>A company can switch its own texts off in its settings (3_sms_enabled).</small></label>' +
        '<div class="cards" style="margin-top:12px"><div class="fld wide"><label>SMS provider <small>(applies to every company, switches instantly)</small></label><div class="sms-sw" id="smsSw" role="group" aria-label="SMS provider"><button type="button" data-prov="msgowl" class="' + (c.provider !== "goveli" ? "on" : "") + '"><b>Message Owl</b><small>Secret: MSGOWL_API_KEY</small></button><button type="button" data-prov="goveli" class="' + (c.provider === "goveli" ? "on" : "") + '"><b>Ooredoo Goveli</b><small>Secret: GOVELI_API_TOKEN</small></button></div></div><div class="fld"><label for="smsSender">Sender ID <small>(Message Owl; Goveli uses the one approved on its account)</small></label><input id="smsSender" maxlength="11" placeholder="e.g. Dhathuru" value="' + esc(c.sender_id || "") + '"></div>' +
        '<div class="fld wide"><label for="smsUrl">Send-sms function address</label><input id="smsUrl" placeholder="https://&lt;project&gt;.supabase.co/functions/v1/send-sms" value="' + esc(c.function_url || "") + '"></div>' +
        '<div class="fld wide"><label for="smsLink">Booking page address <small>(optional, adds a link to each text)</small></label><input id="smsLink" placeholder="https://yourcompany.mv/booking" value="' + esc(c.link_base || "") + '"></div>' +
        '<div class="fld wide"><label for="smsSecret">Shared secret ' + (c.has_secret ? '<small>(saved, leave empty to keep it)</small>' : '<small>(not set)</small>') + '</label><div class="inv" style="margin:0"><input id="smsSecret" autocomplete="off" placeholder="At least 16 characters" value="' + esc(newSecret) + '"><button type="button" class="ghost" id="smsGen">Generate</button></div><small>Save the same value as the <code>SMS_WEBHOOK_SECRET</code> secret on the send-sms function. The Message Owl key goes there too, as <code>MSGOWL_API_KEY</code>. Never in this page.</small></div></div>' +
        '<h3>Sender name for each company</h3><p class="note">Texts can come from the company\'s own name. A sender ID is 3 to 11 letters or digits and must be approved in your SMS account first. A company with none, or one that is not approved yet, uses the default above.</p><div id="smsSenders">' + (senders.length ? senders.map(function (x) {
          return '<div class="inv" data-co="' + esc(x.company_id) + '" style="margin-bottom:8px"><strong style="min-width:150px">' + esc(x.company_name) + '</strong><input data-sn maxlength="11" placeholder="' + esc(x.suggested || "Default") + '" value="' + esc(x.sender_id || "") + '" aria-label="Sender ID for ' + esc(x.company_name) + '" style="max-width:170px"><button type="button" class="ghost" data-use="' + esc(x.suggested || "") + '">Use company name</button><button type="button" class="ghost" data-savesn>Save</button><span class="msg" data-snmsg></span></div>';
        }).join("") : '<p class="note">No companies yet.</p>') + '</div>' +
        '<h3>Message wording</h3><p class="note">Placeholders: <code>{ref}</code> <code>{route}</code> <code>{date}</code> <code>{time}</code> <code>{old_date}</code> <code>{name}</code> <code>{company}</code> <code>{amount}</code> <code>{link}</code>. Leave a box empty to use the standard text.</p>' +
        Object.keys(DEFAULTS).map(function (k) { return '<div class="fld wide" style="margin-bottom:10px"><label for="tp_' + k + '">' + LABELS[k] + '</label><textarea id="tp_' + k + '" rows="2" maxlength="320" placeholder="' + esc(DEFAULTS[k]) + '">' + esc(t[k] || "") + '</textarea></div>'; }).join("") +
        '<div class="actions"><span class="msg" id="smsMsg"></span><button type="button" class="save" id="smsSave">Save SMS settings</button></div>' +
        '<h3>Send a test</h3><div class="inv"><input id="smsTo" placeholder="Mobile number, e.g. 7771234" maxlength="20" aria-label="Test number"><button type="button" class="ghost" id="smsTest">Send test SMS</button><button type="button" class="ghost" id="smsRetry">Send queued messages</button></div>' +
        '<h3>Recent messages</h3><ul class="rows" id="smsLog">' + (log.length ? log.map(function (m) {
          return '<li class="row"><span class="grow"><strong>' + esc(m.company_name || "Test") + ' · ' + esc(m.kind) + '</strong><small>' + esc(m.to_number || "no number") + ' · ' + esc(when(m.created_at)) + '</small><small>' + esc(m.body) + '</small>' + (m.error ? '<small style="color:#b91c1c">' + esc(m.error) + '</small>' : "") + '</span><span class="lk-badge ' + (m.status === "sent" ? "verified" : m.status === "failed" ? "rejected" : m.status === "queued" ? "review" : "none") + '">' + esc(m.status) + '</span></li>';
        }).join("") : '<li class="row"><small>No messages yet.</small></li>') + '</ul>';
      function note(tx, k) { var m = document.getElementById("smsMsg"); m.textContent = tx; m.className = "msg " + (k || ""); }
      [].forEach.call(document.querySelectorAll("#smsSw [data-prov]"), function (b) {
        b.addEventListener("click", function () {
          var want = b.getAttribute("data-prov"); if (b.classList.contains("on")) return;
          note("Switching to " + b.querySelector("b").textContent + "…");
          var cfg = Object.assign({}, c, { provider: want }); delete cfg.has_secret;
          db.rpc("platform_set_sms", { p_cfg: cfg, p_secret: null }).then(function (res) {
            if (res.error) { note(res.error.message, "err"); return; }
            [].forEach.call(document.querySelectorAll("#smsSw button"), function (x) { x.classList.toggle("on", x === b); });
            c.provider = want; note("Now sending through " + b.querySelector("b").textContent + ".", "ok");
          });
        });
      });
      document.getElementById("smsSenders").addEventListener("click", function (e) {
        var row = e.target.closest("[data-co]"); if (!row) return;
        var inp = row.querySelector("[data-sn]"), m = row.querySelector("[data-snmsg]");
        if (e.target.closest("[data-use]")) { inp.value = e.target.closest("[data-use]").getAttribute("data-use"); return; }
        if (e.target.closest("[data-savesn]")) {
          m.textContent = "Saving…"; m.className = "msg";
          db.rpc("platform_set_company_sender", { p_company: row.getAttribute("data-co"), p_sender: inp.value.trim() || null }).then(function (res) {
            if (res.error) { m.textContent = res.error.message; m.className = "msg err"; } else { m.textContent = inp.value.trim() ? "Saved." : "Using the default."; m.className = "msg ok"; }
          });
        }
      });
      document.getElementById("smsGen").addEventListener("click", function () { newSecret = randSecret(); document.getElementById("smsSecret").value = newSecret; });
      document.getElementById("smsSave").addEventListener("click", function () {
        var tpl = {}; Object.keys(DEFAULTS).forEach(function (k) { var v = document.getElementById("tp_" + k).value.trim(); if (v) tpl[k] = v; });
        var cfg = { enabled: document.getElementById("smsOn").checked, provider: document.querySelector("#smsSw .on").getAttribute("data-prov"), sender_id: document.getElementById("smsSender").value.trim(), function_url: document.getElementById("smsUrl").value.trim(), link_base: document.getElementById("smsLink").value.trim(), templates: tpl };
        var sec = document.getElementById("smsSecret").value.trim();
        note("Saving…");
        db.rpc("platform_set_sms", { p_cfg: cfg, p_secret: sec || null }).then(function (res) {
          if (res.error) { note(res.error.message, "err"); return; }
          if (sec) newSecret = ""; note("Saved.", "ok"); load();
        });
      });
      document.getElementById("smsTest").addEventListener("click", function () {
        var to = document.getElementById("smsTo").value.trim(); note("Queuing the test…");
        db.rpc("platform_sms_test", { p_to: to }).then(function (res) { if (res.error) note(res.error.message, "err"); else { note("Test queued. Refreshing the list…", "ok"); setTimeout(load, 3500); } });
      });
      document.getElementById("smsRetry").addEventListener("click", function () {
        db.rpc("platform_sms_retry").then(function (res) { if (res.error) note(res.error.message, "err"); else { note(res.data + " message(s) sent to the function.", "ok"); setTimeout(load, 3500); } });
      });
      void ref;
    });
  }
  window.VeyoraPlatformSms = { mount: function () { root = document.getElementById("smsCfg"); if (root) load(); } };
})();
