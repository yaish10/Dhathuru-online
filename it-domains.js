/* IT → Domains: company custom hostnames (CNAME to the KAHDHU platform target). */
(function () {
  var IC = {
    globe: '<circle cx="12" cy="12" r="9"/><path d="M3 12h18M12 3a14 14 0 0 1 0 18M12 3a14 14 0 0 0 0 18"/>',
    plus: '<path d="M12 5v14M5 12h14"/>',
    ok: '<path d="m5 12 5 5 9-10"/>',
    copy: '<rect x="9" y="9" width="11" height="11" rx="2"/><path d="M5 15V5a2 2 0 0 1 2-2h10"/>'
  };
  function icon(p) { return '<svg viewBox="0 0 24 24">' + p + '</svg>'; }

  function mount(host, opts) {
    if (!host || !opts || !opts.db || !opts.company) return;
    var st = {
      host: host,
      db: opts.db,
      cid: opts.company.id,
      esc: opts.esc || function (s) { return String(s == null ? "" : s).replace(/&/g, "&amp;").replace(/</g, "&lt;").replace(/>/g, "&gt;").replace(/"/g, "&quot;"); },
      canEdit: !!opts.canEdit,
      openModal: opts.openModal,
      closeModal: opts.closeModal,
      board: null,
      busy: false
    };
    host.innerHTML = '<p class="msg">Loading domains…</p>';
    load();

    function rpc(name, args) {
      return st.db.rpc(name, args).then(function (r) {
        if (r.error) throw new Error(r.error.message);
        return r.data;
      });
    }
    function load() {
      return rpc("company_domain_board", { p_company: st.cid }).then(function (b) {
        st.board = b || { cname_target: (window.VEYORA_CONFIG && window.VEYORA_CONFIG.domainCnameTarget) || "customers.kahdhu.com", domains: [] };
        paint();
      }).catch(function (e) {
        var miss = /company_domain_board|does not exist|schema cache/i.test(e.message || "");
        st.host.innerHTML = '<div class="dom-setup"><div class="dom-empty-ic">' + icon(IC.globe) + '</div><h2>' +
          (miss ? "Domains need one database step" : "Could not load domains") + '</h2><p class="note">' +
          st.esc(miss ? "Run migration 0141_company_domains.sql, then reload this page." : e.message) + '</p></div>';
      });
    }
    function target() {
      return (st.board && st.board.cname_target) || (window.VEYORA_CONFIG && window.VEYORA_CONFIG.domainCnameTarget) || "customers.kahdhu.com";
    }
    function chip(status) {
      var cls = status === "active" ? "st-present" : status === "disabled" ? "st-off-duty" : "st-dev-pending";
      var label = status === "active" ? "Active" : status === "disabled" ? "Disabled" : "Pending DNS";
      return '<span class="chip ' + cls + '">' + label + '</span>';
    }
    function paint() {
      var list = (st.board && st.board.domains) || [];
      var tgt = target();
      var head = '<div class="card-head"><div><h2>Custom domains</h2><p class="note">Point your company’s domain at KAHDHU so staff and customers open your URL instead of the shared app host.</p></div>' +
        (st.canEdit ? '<button type="button" class="save" id="domAdd">' + icon(IC.plus) + ' Add domain</button>' : "") + '</div>';
      var how = '<section class="dash-card dom-how"><h2>How it works</h2><ol class="it-steps">' +
        '<li>Add the hostname you want (for example <code>book.yourcompany.com</code>).</li>' +
        '<li>At your DNS provider, create a <strong>CNAME</strong> from that hostname to <code>' + st.esc(tgt) + '</code>.</li>' +
        '<li>When DNS has propagated, mark the domain <strong>Active</strong>. SSL for the custom host is handled on the platform edge (for example Cloudflare for SaaS).</li>' +
        '</ol><p class="hint">CNAME target for every company: <code id="domTarget">' + st.esc(tgt) + '</code> <button type="button" class="ghost manage-btn" id="domCopyTarget">' + icon(IC.copy) + ' Copy</button></p></section>';
      var table = list.length
        ? '<div class="dtable-wrap"><table class="dtable"><thead><tr><th>Hostname</th><th>CNAME</th><th>Status</th><th></th></tr></thead><tbody>' +
          list.map(function (d) {
            return '<tr><td><strong>' + st.esc(d.hostname) + '</strong>' +
              (d.primary_host ? ' <span class="chip st-present">Primary</span>' : "") +
              (d.note ? '<span class="th-sub">' + st.esc(d.note) + '</span>' : "") + '</td>' +
              '<td><code>' + st.esc(d.hostname) + '</code> → <code>' + st.esc(tgt) + '</code></td>' +
              '<td>' + chip(d.status) + '</td>' +
              '<td class="it-acts">' +
              '<button type="button" class="ghost manage-btn" data-domdns="' + d.id + '">DNS</button>' +
              (st.canEdit && d.status !== "active" ? '<button type="button" class="ghost manage-btn" data-domact="' + d.id + '">Activate</button>' : "") +
              (st.canEdit && d.status === "active" ? '<button type="button" class="ghost manage-btn" data-dompend="' + d.id + '">Set pending</button>' : "") +
              (st.canEdit && !d.primary_host && d.status === "active" ? '<button type="button" class="ghost manage-btn" data-dompri="' + d.id + '">Make primary</button>' : "") +
              (st.canEdit && d.status !== "disabled" ? '<button type="button" class="ghost manage-btn" data-domoff="' + d.id + '">Disable</button>' : "") +
              (st.canEdit ? '<button type="button" class="ghost danger manage-btn" data-domdel="' + d.id + '">Remove</button>' : "") +
              '</td></tr>';
          }).join("") + '</tbody></table></div>'
        : '<div class="dom-empty"><div class="dom-empty-ic">' + icon(IC.globe) + '</div><p><strong>No custom domains yet</strong></p><p class="note">Add a hostname, then create the CNAME at your DNS provider.</p></div>';
      st.host.innerHTML = '<section class="dash-card">' + head + table + '</section>' + how;
      bind();
    }
    function find(id) {
      return ((st.board && st.board.domains) || []).filter(function (d) { return d.id === id; })[0];
    }
    function copyText(text) {
      if (navigator.clipboard && navigator.clipboard.writeText) {
        return navigator.clipboard.writeText(text).catch(function () { fallbackCopy(text); });
      }
      fallbackCopy(text);
      return Promise.resolve();
    }
    function fallbackCopy(text) {
      var ta = document.createElement("textarea");
      ta.value = text; document.body.appendChild(ta); ta.select();
      try { document.execCommand("copy"); } catch (e) {}
      ta.remove();
    }
    function showDns(d) {
      var tgt = target();
      var html = '<h2>DNS for ' + st.esc(d.hostname) + '</h2>' +
        '<p class="note">Add these records at the DNS host for <strong>' + st.esc(d.hostname) + '</strong>.</p>' +
        '<div class="dom-dns">' +
        '<div class="dom-dns-row"><span>Type</span><strong>CNAME</strong></div>' +
        '<div class="dom-dns-row"><span>Name / host</span><code>' + st.esc(d.hostname) + '</code> <button type="button" class="ghost manage-btn" data-copy="' + st.esc(d.hostname) + '">Copy</button></div>' +
        '<div class="dom-dns-row"><span>Points to</span><code>' + st.esc(tgt) + '</code> <button type="button" class="ghost manage-btn" data-copy="' + st.esc(tgt) + '">Copy</button></div>' +
        '<div class="dom-dns-row"><span>Optional TXT</span><code>' + st.esc(d.txt_name || ("_kahdhu-verify." + d.hostname)) + '</code> = <code>' + st.esc(d.txt_value || d.verify_token) + '</code></div>' +
        '</div>' +
        '<p class="hint">TTL can stay at the provider default. After the CNAME resolves, activate the domain on this page.</p>' +
        '<div class="modal-actions"><button type="button" class="ghost" data-close>Close</button>' +
        (st.canEdit && d.status !== "active" ? '<button type="button" class="save" id="domActNow">' + icon(IC.ok) + ' Mark active</button>' : "") +
        '</div>';
      if (st.openModal) st.openModal(html);
      else st.host.insertAdjacentHTML("beforeend", '<div class="dom-inline-dns">' + html + '</div>');
      var card = document.getElementById("modalCard") || st.host;
      card.querySelectorAll("[data-copy]").forEach(function (b) {
        b.addEventListener("click", function () { copyText(b.getAttribute("data-copy")); b.textContent = "Copied"; });
      });
      var go = document.getElementById("domActNow");
      if (go) go.addEventListener("click", function () { setStatus(d.id, "active"); });
    }
    function openAdd() {
      if (!st.canEdit || !st.openModal) return;
      st.openModal('<h2>Add domain</h2><p class="note">Use the full hostname customers or staff will type in the browser.</p>' +
        '<div class="fld"><label for="domHost">Hostname</label><input id="domHost" maxlength="180" placeholder="book.yourcompany.com" autocomplete="off"></div>' +
        '<div class="fld"><label for="domNote">Note (optional)</label><input id="domNote" maxlength="200" placeholder="e.g. booking site"></div>' +
        '<p class="msg" id="mMsg" role="status"></p>' +
        '<div class="modal-actions"><button type="button" class="ghost" data-close>Cancel</button><button type="button" class="save" id="domGo">Add domain</button></div>');
      var go = document.getElementById("domGo");
      if (go) go.addEventListener("click", function () {
        var host = (document.getElementById("domHost").value || "").trim();
        var note = (document.getElementById("domNote").value || "").trim();
        var m = document.getElementById("mMsg");
        if (!host) { m.textContent = "Enter a hostname."; m.className = "msg err"; return; }
        if (st.busy) return; st.busy = true; go.disabled = true;
        rpc("add_company_domain", { p_company: st.cid, p_hostname: host, p_note: note || null }).then(function (row) {
          st.busy = false;
          if (st.closeModal) st.closeModal();
          return load().then(function () { if (row) showDns(Object.assign({ status: "pending" }, row)); });
        }).catch(function (e) {
          st.busy = false; go.disabled = false;
          m.textContent = e.message; m.className = "msg err";
        });
      });
    }
    function setStatus(id, status, primary) {
      if (st.busy) return;
      st.busy = true;
      rpc("set_company_domain_status", { p_id: id, p_status: status, p_primary: primary == null ? null : !!primary }).then(function () {
        st.busy = false;
        if (st.closeModal) st.closeModal();
        return load();
      }).catch(function (e) {
        st.busy = false;
        alert(e.message);
      });
    }
    function remove(id) {
      var d = find(id);
      if (!d || !confirm("Remove " + d.hostname + "? DNS can stay in place, but KAHDHU will stop recognising this host.")) return;
      if (st.busy) return; st.busy = true;
      rpc("remove_company_domain", { p_id: id }).then(function () { st.busy = false; return load(); })
        .catch(function (e) { st.busy = false; alert(e.message); });
    }
    function bind() {
      var add = document.getElementById("domAdd");
      if (add) add.addEventListener("click", openAdd);
      var ct = document.getElementById("domCopyTarget");
      if (ct) ct.addEventListener("click", function () { copyText(target()); ct.textContent = "Copied"; });
      st.host.querySelectorAll("[data-domdns]").forEach(function (b) {
        b.addEventListener("click", function () { var d = find(b.getAttribute("data-domdns")); if (d) showDns(d); });
      });
      st.host.querySelectorAll("[data-domact]").forEach(function (b) {
        b.addEventListener("click", function () {
          var d = find(b.getAttribute("data-domact"));
          if (!d) return;
          if (!confirm("Mark " + d.hostname + " as active? Only do this after the CNAME points to " + target() + ".")) return;
          setStatus(d.id, "active");
        });
      });
      st.host.querySelectorAll("[data-dompend]").forEach(function (b) {
        b.addEventListener("click", function () { setStatus(b.getAttribute("data-dompend"), "pending"); });
      });
      st.host.querySelectorAll("[data-domoff]").forEach(function (b) {
        b.addEventListener("click", function () { setStatus(b.getAttribute("data-domoff"), "disabled"); });
      });
      st.host.querySelectorAll("[data-dompri]").forEach(function (b) {
        b.addEventListener("click", function () { setStatus(b.getAttribute("data-dompri"), "active", true); });
      });
      st.host.querySelectorAll("[data-domdel]").forEach(function (b) {
        b.addEventListener("click", function () { remove(b.getAttribute("data-domdel")); });
      });
    }
  }

  window.ItDomains = { mount: mount };
})();
