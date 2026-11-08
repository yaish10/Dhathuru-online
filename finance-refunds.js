/* Finance → Refunds: approval gate, proof uploads, payout details, confirm / decline. */
(function () {
  var BUCKET = "refund-proofs";
  var METHODS = ["Bank transfer", "Cash", "Card reversal", "Mobile money", "Cheque", "Other"];

  function esc(t) {
    return String(t == null ? "" : t).replace(/[&<>"']/g, function (c) {
      return { "&": "&amp;", "<": "&lt;", ">": "&gt;", '"': "&quot;", "'": "&#39;" }[c];
    });
  }
  function money(api, n) { return api.money(Number(n) || 0); }
  function when(v) {
    if (!v) return "—";
    try { return new Date(v).toLocaleString(); } catch (e) { return String(v).slice(0, 16); }
  }
  function day(v) {
    if (!v) return "—";
    return String(v).slice(0, 10);
  }
  function match(row, q) {
    if (!q) return true;
    var hay = [row.reference, row.name, row.phone, row.email, row.route, row.reason, row.ops_by, row.finance_by, row.ops_note, row.finance_note, row.payout_method, row.payout_ref, row.finance_approve_note]
      .join(" ").toLowerCase();
    return hay.indexOf(q) >= 0;
  }
  function proofsOf(row) {
    return Array.isArray(row && row.proofs) ? row.proofs : [];
  }
  function needsApprove(row) {
    return !!(row && row.needs_approval && !row.finance_approved_at);
  }
  function canPay(row) {
    return !!(row && row.approved);
  }
  function refundAmt(row) {
    var a = Number(row && row.amount);
    if (a > 0) return a;
    var paid = Number(row && row.paid_amount);
    return paid > 0 ? paid : 0;
  }
  function statusChip(row) {
    if (row && row.stage === "ops") return '<span class="fr-chip ops">With Operations</span>';
    if (needsApprove(row)) return '<span class="fr-chip wait">Needs approval</span>';
    if (row.needs_approval) return '<span class="fr-chip ok">Approved</span>';
    return '<span class="fr-chip ready">Ready to pay</span>';
  }
  function initials(name) {
    var parts = String(name || "P").trim().split(/\s+/).filter(Boolean).slice(0, 2);
    return (parts.map(function (p) { return p.charAt(0).toUpperCase(); }).join("") || "P");
  }
  function relTime(v) {
    if (!v) return "";
    var t = new Date(v).getTime(), d = Date.now() - t;
    if (!isFinite(t)) return "";
    if (d < 6e4) return "Just now";
    if (d < 36e5) return Math.floor(d / 6e4) + "m ago";
    if (d < 864e5) return Math.floor(d / 36e5) + "h ago";
    if (d < 6048e5) return Math.floor(d / 864e5) + "d ago";
    return day(v);
  }
  function svg(p) {
    return '<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round">' + p + '</svg>';
  }
  var IC = {
    route: '<circle cx="6" cy="18" r="2.5"/><circle cx="18" cy="6" r="2.5"/><path d="M8.5 18H15a3 3 0 0 0 0-6H9a3 3 0 0 1 0-6h6.5"/>',
    lock: '<rect x="5" y="11" width="14" height="10" rx="2"/><path d="M8 11V8a4 4 0 0 1 8 0v3"/>',
    check: '<path d="m5 13 4 4L19 7"/>',
    file: '<path d="M7 3h7l5 5v13H7zM14 3v5h5"/>',
    pay: '<rect x="3" y="6" width="18" height="13" rx="2"/><path d="M3 10h18M15 15h3"/>',
    clock: '<circle cx="12" cy="12" r="9"/><path d="M12 7v5l3 2"/>',
    user: '<circle cx="12" cy="8" r="3.5"/><path d="M5 20c0-3.5 3-6 7-6s7 2.5 7 6"/>',
    spark: '<path d="M12 3v4M12 17v4M3 12h4M17 12h4M5.6 5.6l2.8 2.8M15.6 15.6l2.8 2.8M18.4 5.6l-2.8 2.8M8.4 15.6l-2.8 2.8"/>',
    ticket: '<path d="M4 8h16v3a2 2 0 0 0 0 4v3H4v-3a2 2 0 0 0 0-4V8Z"/>',
    x: '<path d="M6 6l12 12M18 6L6 18"/>',
    eye: '<path d="M2 12s3.5-7 10-7 10 7 10 7-3.5 7-10 7S2 12 2 12z"/><circle cx="12" cy="12" r="3"/>'
  };
  function ticketBtn(bookingId, cls) {
    if (!bookingId) return "";
    return '<button type="button" class="' + (cls || "frc-more") + '" data-fr-ticket="' + esc(bookingId) + '">' + svg(IC.ticket) + '<span>View ticket</span></button>';
  }
  function waitTone(row) {
    if (needsApprove(row)) return "need";
    if (canPay(row)) return "go";
    return "prep";
  }
  function waitNext(row) {
    if (needsApprove(row)) return { key: "approve", label: "Approve refund", hint: "Mark paid stays locked until Finance approves." };
    if (!proofsOf(row).length) return { key: "pay", label: "Mark paid", hint: "Confirm payout to update Finance totals." };
    return { key: "pay", label: "Mark paid", hint: "Proof on file — confirm payout to update totals." };
  }
  function waitSteps(row) {
    var proofs = proofsOf(row).length;
    return [
      { lab: "Ops", done: true },
      { lab: "Approve", done: !needsApprove(row) },
      { lab: "Proof", done: proofs > 0 },
      { lab: "Pay", done: false, next: canPay(row) }
    ];
  }
  function waitingCard(api, x, i) {
    var tone = waitTone(x), next = waitNext(x), steps = waitSteps(x);
    var proofs = proofsOf(x), locked = needsApprove(x);
    var reason = String(x.reason || "").trim();
    if (reason.length > 72) reason = reason.slice(0, 70) + "…";
    return '<article class="frc tone-' + tone + '" style="--i:' + i + '" data-fr-view="' + esc(x.id) + '" data-fr-list="waiting" tabindex="0" role="button">' +
      '<div class="frc-glow" aria-hidden="true"></div>' +
      '<header class="frc-top">' +
        '<div class="frc-who"><span class="frc-av" data-t="' + tone + '">' + esc(initials(x.name)) + '</span>' +
          '<div><strong>' + esc(x.name || "Passenger") + '</strong>' +
          '<small>' + esc(x.reference || "Booking") + (x.phone ? " · " + esc(x.phone) : "") + '</small></div></div>' +
        statusChip(x) +
      '</header>' +
      '<div class="frc-amt"><span>Amount to pay</span><b>' + esc(money(api, refundAmt(x))) + '</b></div>' +
      '<div class="frc-meta">' +
        '<div>' + svg(IC.route) + '<div><em>Route</em><strong>' + esc(x.route || "—") + '</strong></div></div>' +
        '<div>' + svg(IC.clock) + '<div><em>Departure</em><strong>' + esc(day(x.depart_at)) + '</strong></div></div>' +
        '<div>' + svg(IC.user) + '<div><em>Ops approved</em><strong>' + esc(x.ops_by || "Operations") + '</strong><small>' + esc(relTime(x.ops_at) || when(x.ops_at)) + '</small></div></div>' +
        '<div>' + svg(IC.pay) + '<div><em>Original pay</em><strong>' + esc(x.payment_method || "—") + '</strong></div></div>' +
      '</div>' +
      (reason ? '<p class="frc-reason">' + esc(reason) + '</p>' : "") +
      '<ol class="frc-steps" aria-label="Refund progress">' + steps.map(function (s) {
        return '<li class="' + (s.done ? "done" : s.next ? "next" : "") + '"><i></i><span>' + esc(s.lab) + '</span></li>';
      }).join("") + '</ol>' +
      '<ul class="frc-checks">' +
        '<li class="' + (locked ? "todo" : "ok") + '">' + svg(locked ? IC.lock : IC.check) + '<span>' + (locked ? "Finance approval needed" : "Finance approval clear") + '</span></li>' +
        '<li class="' + (proofs.length ? "ok" : "") + '">' + svg(proofs.length ? IC.check : IC.file) + '<span>' +
          (proofs.length ? (proofs.length + " proof file" + (proofs.length === 1 ? "" : "s") + " attached") : "Add proof of refund") + '</span></li>' +
        '<li class="' + (canPay(x) ? "ok" : "todo") + '">' + svg(canPay(x) ? IC.spark : IC.pay) + '<span>' + next.hint + '</span></li>' +
      '</ul>' +
      '<footer class="frc-foot">' +
        '<button type="button" class="frc-cta" data-fr-view="' + esc(x.id) + '" data-fr-list="waiting">' +
          (locked ? svg(IC.lock) : svg(IC.check)) +
          '<span>' + esc(next.label) + '</span></button>' +
        ticketBtn(x.booking_id) +
        '<button type="button" class="frc-more" data-fr-view="' + esc(x.id) + '" data-fr-list="waiting">Details</button>' +
      '</footer>' +
    '</article>';
  }
  function opsPendingCard(api, x, i) {
    var reason = String(x.reason || "").trim();
    if (reason.length > 72) reason = reason.slice(0, 70) + "…";
    return '<article class="frc tone-ops" style="--i:' + i + '" data-fr-view="' + esc(x.id) + '" data-fr-list="ops" tabindex="0" role="button">' +
      '<div class="frc-glow" aria-hidden="true"></div>' +
      '<header class="frc-top">' +
        '<div class="frc-who"><span class="frc-av" data-t="ops">' + esc(initials(x.name)) + '</span>' +
          '<div><strong>' + esc(x.name || "Passenger") + '</strong>' +
          '<small>' + esc(x.reference || "Booking") + (x.phone ? " · " + esc(x.phone) : "") + '</small></div></div>' +
        statusChip(x) +
      '</header>' +
      '<div class="frc-amt"><span>Amount to pay</span><b>' + esc(money(api, refundAmt(x))) + '</b></div>' +
      '<div class="frc-meta">' +
        '<div>' + svg(IC.route) + '<div><em>Route</em><strong>' + esc(x.route || "—") + '</strong></div></div>' +
        '<div>' + svg(IC.clock) + '<div><em>Departure</em><strong>' + esc(day(x.depart_at)) + '</strong></div></div>' +
        '<div>' + svg(IC.user) + '<div><em>Requested by</em><strong>' + esc(x.requested_by || "Staff") + '</strong><small>' + esc(relTime(x.created_at) || when(x.created_at)) + '</small></div></div>' +
        '<div>' + svg(IC.pay) + '<div><em>Stage</em><strong>Ops head approval</strong></div></div>' +
      '</div>' +
      (reason ? '<p class="frc-reason">' + esc(reason) + '</p>' : "") +
      '<ol class="frc-steps" aria-label="Refund progress">' +
        '<li class="next"><i></i><span>Ops</span></li>' +
        '<li><i></i><span>Approve</span></li>' +
        '<li><i></i><span>Proof</span></li>' +
        '<li><i></i><span>Pay</span></li>' +
      '</ol>' +
      '<ul class="frc-checks">' +
        '<li class="todo">' + svg(IC.lock) + '<span>Waiting for the Operations head on Approvals</span></li>' +
        '<li class="todo">' + svg(IC.pay) + '<span>Finance can prepare, but Mark paid unlocks after Ops approves</span></li>' +
      '</ul>' +
      '<footer class="frc-foot">' +
        '<button type="button" class="frc-cta" data-fr-view="' + esc(x.id) + '" data-fr-list="ops">' + svg(IC.clock) + '<span>View request</span></button>' +
        ticketBtn(x.booking_id) +
        '<button type="button" class="frc-more" data-fr-view="' + esc(x.id) + '" data-fr-list="ops">Details</button>' +
      '</footer>' +
    '</article>';
  }

  function emptyBoard() {
    return {
      waiting: [], ops: [], records: [], rejected: [],
      waiting_total: 0, waiting_count: 0, ops_count: 0, paid_total: 0, paid_count: 0,
      needs_approval_count: 0, ready_count: 0, threshold: 2000
    };
  }

  function load(api) {
    return api.db.rpc("finance_refund_board", { p_company: api.company.id }).then(function (r) {
      if (r.error) throw new Error(r.error.message);
      api.board = r.data || emptyBoard();
      ["waiting", "ops", "records", "rejected"].forEach(function (k) {
        if (!Array.isArray(api.board[k])) api.board[k] = [];
      });
      return api.board;
    });
  }

  function kpis(api) {
    var b = api.board || emptyBoard();
    var thr = Number(b.threshold);
    var opsN = (b.ops || []).length || Number(b.ops_count) || 0;
    return '<div class="fr-kpis">' +
      '<div class="fr-kpi wait"><small>Waiting for Finance</small><strong>' + esc(money(api, b.waiting_total)) + '</strong><em>' + (Number(b.waiting_count) || 0) + ' refund' + ((Number(b.waiting_count) || 0) === 1 ? "" : "s") + '</em></div>' +
      '<div class="fr-kpi ops"><small>With Operations</small><strong>' + opsN + '</strong><em>sent for Ops head approval</em></div>' +
      '<div class="fr-kpi paid"><small>Ready to pay</small><strong>' + (Number(b.ready_count) || 0) + '</strong><em>approved or under ' + esc(money(api, isFinite(thr) ? thr : 2000)) + '</em></div>' +
      '<div class="fr-kpi note"><small>Paid last 30 days</small><strong>' + esc(money(api, b.paid_total)) + '</strong><em>' + (Number(b.paid_count) || 0) + ' confirmed · totals change on Mark paid</em></div>' +
    '</div>';
  }

  function tabs(api) {
    var tab = api.tab || "waiting";
    var b = api.board || emptyBoard();
    var pending = (b.waiting || []).length + (b.ops || []).length;
    var items = [
      ["waiting", "Pending", pending],
      ["ops", "With Operations", (b.ops || []).length],
      ["done", "Paid", (b.records || []).length],
      ["rejected", "Declined", (b.rejected || []).length]
    ];
    return '<div class="fr-tabs" role="tablist">' + items.map(function (t) {
      return '<button type="button" data-fr-tab="' + t[0] + '"' + (tab === t[0] ? ' class="on" aria-current="page"' : "") + '>' +
        esc(t[1]) + (t[2] ? '<b>' + t[2] + '</b>' : "") + '</button>';
    }).join("") + '</div>';
  }

  function waitFilter(api) {
    var f = api.waitFilter || "all";
    var b = api.board || emptyBoard();
    var items = [
      ["all", "All", (b.waiting || []).length + (b.ops || []).length],
      ["ops", "With Operations", (b.ops || []).length],
      ["approve", "Needs Finance approval", Number(b.needs_approval_count) || 0],
      ["ready", "Ready to pay", Number(b.ready_count) || 0]
    ];
    return '<div class="fr-filters">' + items.map(function (t) {
      return '<button type="button" data-fr-wfilt="' + t[0] + '"' + (f === t[0] ? ' class="on"' : "") + '>' +
        esc(t[1]) + (t[2] ? '<b>' + t[2] + '</b>' : "") + '</button>';
    }).join("") + '</div>';
  }

  function toolbar(api) {
    return '<div class="fr-bar">' +
      '<label class="fr-search"><svg viewBox="0 0 24 24"><circle cx="11" cy="11" r="7"/><path d="m20 20-3.5-3.5"/></svg>' +
      '<input type="search" id="frQ" placeholder="Search booking, passenger, route…" value="' + esc(api.q || "") + '" aria-label="Search refunds"></label>' +
      '<button type="button" class="ghost" id="frRefresh">Refresh</button>' +
    '</div>';
  }

  function waitingList(api) {
    var f = api.waitFilter || "all";
    return (api.board.waiting || []).filter(function (x) {
      if (!match(x, api.q)) return false;
      if (f === "approve") return needsApprove(x);
      if (f === "ready") return !!x.approved;
      return true;
    });
  }

  function waitingRows(api) {
    var list = waitingList(api);
    var f = api.waitFilter || "all";
    var ops = (api.board.ops || []).filter(function (x) { return match(x, api.q); });
    var showOps = f === "all" || f === "ops";
    var showFin = f !== "ops";
    var opsBlock = (showOps && ops.length)
      ? '<div class="frc-sec"><div class="frc-sec-h"><strong>Awaiting Operations</strong><span>' + ops.length + ' sent for approval</span></div>' +
        '<div class="frc-grid" role="list">' + ops.map(function (x, i) { return opsPendingCard(api, x, i); }).join("") + '</div></div>'
      : "";
    var finBlock = "";
    if (showFin) {
      if (!list.length && !(showOps && ops.length && f === "all")) {
        finBlock = '<div class="frc-empty">' +
          '<div class="frc-empty-ic" aria-hidden="true">' + svg(IC.pay) + '</div>' +
          '<strong>' + (api.q || f !== "all" ? "No matching Finance refunds" : (ops.length ? "Nothing with Finance yet" : "Queue is clear")) + '</strong>' +
          '<p>' + (api.q || f !== "all"
            ? "Try another filter or clear the search."
            : (ops.length
              ? "Ops still needs to approve the request" + (ops.length === 1 ? "" : "s") + " above. After that, they move here for payout."
              : "When a paid booking is cancelled, it appears here for Ops then Finance.")) + '</p>' +
        '</div>';
      } else if (list.length) {
        finBlock = '<div class="frc-sec"><div class="frc-sec-h"><strong>Ready for Finance</strong><span>' + list.length + ' to process</span></div>' +
          '<div class="frc-grid" role="list">' + list.map(function (x, i) { return waitingCard(api, x, i); }).join("") + '</div></div>';
      }
    }
    if (!opsBlock && !finBlock) {
      return waitFilter(api) +
        '<div class="frc-empty">' +
          '<div class="frc-empty-ic" aria-hidden="true">' + svg(IC.pay) + '</div>' +
          '<strong>No matching pending refunds</strong>' +
          '<p>Try another filter or clear the search.</p></div>';
    }
    return waitFilter(api) + opsBlock + finBlock;
  }

  function opsRows(api) {
    var list = (api.board.ops || []).filter(function (x) { return match(x, api.q); });
    if (!list.length) return '<div class="frc-empty"><div class="frc-empty-ic" aria-hidden="true">' + svg(IC.clock) + '</div><strong>' + (api.q ? "No Operations items match" : "Nothing with Operations") + '</strong><p>' + (api.q ? "Try another search." : "Paid cancellations waiting on the Ops head will show here.") + '</p></div>';
    return '<p class="note">Finance can see these, but cannot mark them paid until the Operations head approves on Approvals.</p>' +
      '<div class="frc-grid" role="list">' + list.map(function (x, i) { return opsPendingCard(api, x, i); }).join("") + '</div>';
  }

  function doneRows(api) {
    var list = (api.board.records || []).filter(function (x) { return match(x, api.q); });
    if (!list.length) return '<div class="fr-empty">' + (api.q ? "No paid refunds match that search." : "No refunds have been confirmed in the last 180 days.") + '</div>';
    return '<div class="dtable-wrap"><table class="dtable fr-table"><thead><tr>' +
      '<th>Booking</th><th>Passenger</th><th>Amount</th><th>Payout</th><th>Paid</th><th></th></tr></thead><tbody>' +
      list.map(function (x) {
        return '<tr>' +
          '<td><strong>' + esc(x.reference || "Booking") + '</strong><small class="td-subline">' + esc(x.route || "") + '</small></td>' +
          '<td>' + esc(x.name || "") + '</td>' +
          '<td><strong>' + esc(money(api, refundAmt(x))) + '</strong></td>' +
          '<td>' + esc(x.payout_method || "—") + (x.payout_ref ? '<small class="td-subline">' + esc(x.payout_ref) + '</small>' : "") + '</td>' +
          '<td>' + esc(when(x.finance_at)) + '<small class="td-subline">' + esc(x.finance_by || "") + '</small></td>' +
          '<td class="fr-acts"><button type="button" class="ghost" data-fr-ticket="' + esc(x.booking_id) + '">Ticket</button>' +
            '<button type="button" class="ghost" data-fr-view="' + esc(x.id) + '" data-fr-list="done">Open</button></td></tr>';
      }).join("") +
      '</tbody></table></div>';
  }

  function rejectedRows(api) {
    var list = (api.board.rejected || []).filter(function (x) { return match(x, api.q); });
    if (!list.length) return '<div class="fr-empty">' + (api.q ? "No declined refunds match that search." : "No declined refunds in the last 180 days.") + '</div>';
    return '<div class="dtable-wrap"><table class="dtable fr-table"><thead><tr>' +
      '<th>Booking</th><th>Passenger</th><th>Amount</th><th>Declined by</th><th>Note</th><th>When</th></tr></thead><tbody>' +
      list.map(function (x) {
        return '<tr>' +
          '<td><strong>' + esc(x.reference || "Booking") + '</strong></td>' +
          '<td>' + esc(x.name || "") + '</td>' +
          '<td>' + esc(money(api, refundAmt(x))) + '</td>' +
          '<td>' + esc(x.who || "—") + (x.finance_by || x.ops_by ? " · " + esc(x.finance_by || x.ops_by) : "") + '</td>' +
          '<td>' + esc(x.finance_note || x.ops_note || "—") + '</td>' +
          '<td>' + esc(when(x.finance_at || x.ops_at || x.created_at)) + '</td></tr>';
      }).join("") +
      '</tbody></table></div>';
  }

  function findRow(api, id, list) {
    var key = list === "done" ? "records" : list === "ops" ? "ops" : list === "rejected" ? "rejected" : "waiting";
    var rows = (api.board && api.board[key]) || [];
    for (var i = 0; i < rows.length; i++) if (String(rows[i].id) === String(id)) return rows[i];
    return null;
  }

  function sheetMode(row, list) {
    if (list === "ops") return "ops";
    if (list === "done") return "done";
    if (list === "rejected") return "rejected";
    if (needsApprove(row)) return "approve";
    return "pay";
  }
  function timeline(row) {
    var opsDone = !!(row.ops_at || row.stage === "finance" || row.stage === "done");
    var finOk = opsDone && !needsApprove(row) && !!(row.finance_approved_at || !row.needs_approval || row.stage === "done");
    var steps = [
      { lab: "Requested", on: true, now: row.stage === "ops" && !opsDone, who: row.requested_by, at: row.created_at },
      { lab: "Operations", on: opsDone, now: row.stage === "ops", who: row.ops_by || (row.stage === "ops" ? "Waiting" : ""), at: row.ops_at },
      { lab: "Finance", on: finOk, now: row.stage === "finance" && needsApprove(row), who: row.finance_approved_by || (!row.needs_approval ? "Under threshold" : ""), at: row.finance_approved_at },
      { lab: "Paid", on: row.stage === "done", now: false, who: row.finance_by, at: row.finance_at }
    ];
    return '<ol class="frs-rail" aria-label="Refund journey">' + steps.map(function (s, i) {
      return '<li class="' + (s.on ? "done" : "") + (s.now ? " now" : "") + '">' +
        '<span class="frs-dot"><i>' + (s.on ? svg(IC.check) : String(i + 1)) + '</i></span>' +
        '<strong>' + esc(s.lab) + '</strong>' +
        '<small>' + esc(s.on ? ([s.who, s.at ? relTime(s.at) || when(s.at) : ""].filter(Boolean).join(" · ") || "Done") : (s.now ? "In progress" : "Pending")) + '</small>' +
      '</li>';
    }).join("") + '</ol>';
  }

  function ocrOf(p) {
    return p && p.ocr && typeof p.ocr === "object" ? p.ocr : null;
  }
  function ocrChips(ocr) {
    if (!ocr) return "";
    var bits = [];
    if (ocr.amount) bits.push((ocr.currency || "") + " " + ocr.amount);
    if (ocr.reference_no) bits.push("Ref " + ocr.reference_no);
    if (ocr.bank) bits.push(ocr.bank);
    if (ocr.status) bits.push(ocr.status);
    if (ocr.transaction_date) bits.push(String(ocr.transaction_date).slice(0, 16));
    if (!bits.length) return "";
    return '<div class="frs-ocr-chips">' + bits.map(function (b) { return '<span>' + esc(String(b).trim()) + '</span>'; }).join("") + '</div>';
  }
  function proofListHtml(row, editable) {
    var list = proofsOf(row);
    if (!list.length) {
      return '<div class="frs-proofs empty">' +
        '<div class="frs-proof-empty-ic">' + svg(IC.file) + '</div>' +
        '<strong>' + (editable ? "Add proof of refund" : "No proof on file") + '</strong>' +
        '<p>' + (editable ? "Drop a transfer slip or receipt — we scan it and fill the payout fields." : "Nothing was attached to this refund.") + '</p></div>';
    }
    return '<ul class="frs-proofs">' + list.map(function (p, i) {
      var ext = String(p.name || "").split(".").pop().toUpperCase().slice(0, 4) || "FILE";
      var ocr = ocrOf(p);
      return '<li style="--i:' + i + '"><span class="frs-file-ic" aria-hidden="true">' + esc(ext) + '</span>' +
        '<div class="frs-file-meta"><strong>' + esc(p.name || "File") + '</strong><small>' +
          (p.size ? Math.max(1, Math.round((p.size || 0) / 1024)) + " KB" : "Attached") +
          (p.at ? " · " + esc(relTime(p.at) || when(p.at)) : "") +
          (ocr ? " · Scanned" : "") + '</small>' + ocrChips(ocr) + '</div>' +
        '<span class="frs-proof-acts">' +
          '<button type="button" class="frs-icon-btn" data-fr-openproof="' + esc(p.path) + '" title="Open">' + svg(IC.eye) + '</button>' +
          (editable ? '<button type="button" class="frs-icon-btn danger" data-fr-rmproof="' + esc(row.id) + '" data-path="' + esc(p.path) + '" title="Remove">' + svg(IC.x) + '</button>' : "") +
        '</span></li>';
    }).join("") + '</ul>';
  }

  function fact(lab, val, sub) {
    return '<div class="frs-fact"><small>' + esc(lab) + '</small><strong>' + esc(val || "—") + '</strong>' +
      (sub ? '<em>' + esc(sub) + '</em>' : "") + '</div>';
  }
  function noteCard(lab, body, tone) {
    if (!body) return "";
    return '<div class="frs-note ' + (tone || "") + '"><small>' + esc(lab) + '</small><p>' + body + '</p></div>';
  }

  function detailHtml(api, row, list) {
    if (!row) {
      return '<div class="frs"><div class="frs-empty"><strong>Refund not found</strong><p>This refund is no longer on the board.</p>' +
        '<button type="button" class="ghost" data-close>Close</button></div></div>';
    }
    var mode = sheetMode(row, list);
    var waiting = list === "waiting";
    var locked = mode === "approve";
    var proofs = proofsOf(row);
    var thr = Number((api.board || {}).threshold);
    var methods = METHODS.slice();
    if (row.payment_method && methods.indexOf(row.payment_method) < 0) methods.unshift(row.payment_method);
    var title = mode === "approve" ? "Approve refund" : mode === "pay" ? "Proof & payout" : mode === "ops" ? "Awaiting Operations" : mode === "done" ? "Refund paid" : "Refund details";
    var kicker = mode === "approve" ? "Finance approval required" : mode === "pay" ? "Confirm payout" : mode === "ops" ? "Ops head must approve first" : "Record";
    var actionPanel = "";
    if (mode === "approve") {
      actionPanel =
        '<section class="frs-panel tone-approve">' +
          '<div class="frs-panel-h"><span class="frs-step-badge">1</span><div><strong>Approve to unlock payout</strong><p>Mark paid stays locked until Finance approves. Threshold ' + esc(money(api, isFinite(thr) ? thr : 2000)) + '.</p></div></div>' +
          '<label class="frs-field"><span>Approval note</span><textarea id="frNote" rows="3" maxlength="400" placeholder="Why you are approving, or anything Finance should know…"></textarea></label>' +
          '<div class="frs-lock">' + svg(IC.lock) + '<div><strong>Payout locked</strong><span>After approval you can mark paid and add proof.</span></div></div>' +
        '</section>';
    } else if (mode === "pay") {
      actionPanel =
        '<section class="frs-panel tone-pay">' +
          '<div class="frs-panel-h"><span class="frs-step-badge go">2</span><div><strong>Proof of refund</strong><p>We scan slips and fill reference, bank and amount. PNG, JPG or WebP · up to 10 MB.</p></div>' +
            '<b class="frs-proof-count">' + proofs.length + '/8</b></div>' +
          proofListHtml(row, true) +
          '<div id="frOcrBox" class="frs-ocr" hidden></div>' +
          '<label class="frs-drop" id="frDrop">' +
            '<input type="file" id="frProof" accept=".pdf,image/png,image/jpeg,image/webp,image/heic">' +
            '<span class="frs-drop-ic">' + svg(IC.file) + '</span>' +
            '<strong>Drop proof here or browse</strong>' +
            '<small>Transfer slip · bank advice · receipt</small>' +
            '<div class="frs-scan" id="frScan" hidden><i></i><span>Scanning document…</span></div>' +
          '</label>' +
          '<div class="frs-pay-grid">' +
            '<label class="frs-field"><span>Payout method</span><select id="frMethod">' +
              methods.map(function (m) { return '<option value="' + esc(m) + '"' + (m === (row.payout_method || methods[0]) ? " selected" : "") + '>' + esc(m) + '</option>'; }).join("") +
            '</select></label>' +
            '<label class="frs-field"><span>Reference / slip no.</span><input id="frRef" type="text" maxlength="120" placeholder="Bank ref, receipt no…" value="' + esc(row.payout_ref || "") + '"></label>' +
          '</div>' +
          '<label class="frs-field"><span>Note for the record</span><textarea id="frNote" rows="2" maxlength="400" placeholder="Add a note. Required if you decline."></textarea></label>' +
        '</section>';
    } else if (waiting === false) {
      actionPanel =
        '<section class="frs-panel tone-view">' +
          '<div class="frs-panel-h"><div><strong>Proof of refund</strong><p>Files kept with this payout record.</p></div></div>' +
          proofListHtml(row, false) +
        '</section>';
    }

    var foot =
      mode === "approve"
        ? '<div class="frs-foot">' +
            '<button type="button" class="frs-btn ghost" data-close>Close</button>' +
            '<button type="button" class="frs-btn danger" data-fr-decline="' + esc(row.id) + '">Decline</button>' +
            '<button type="button" class="frs-btn primary approve" data-fr-approve="' + esc(row.id) + '">' + svg(IC.check) + '<span>Approve refund</span></button>' +
          '</div>'
        : mode === "pay"
          ? '<div class="frs-foot">' +
              '<button type="button" class="frs-btn ghost" data-close>Close</button>' +
              '<button type="button" class="frs-btn danger" data-fr-decline="' + esc(row.id) + '">Decline</button>' +
              '<button type="button" class="frs-btn primary pay" data-fr-pay="' + esc(row.id) + '">' +
                svg(IC.check) + '<span>Mark refund paid</span></button>' +
            '</div>'
          : '<div class="frs-foot"><button type="button" class="frs-btn ghost" data-close>Close</button></div>';

    return '<div class="frs mode-' + mode + '">' +
      '<header class="frs-hero">' +
        '<div class="frs-hero-glow" aria-hidden="true"></div>' +
        '<div class="frs-hero-top">' +
          '<div class="frs-who"><span class="frs-av">' + esc(initials(row.name)) + '</span>' +
            '<div><small>' + esc(kicker) + '</small><h2>' + esc(row.reference || "Refund") + '</h2>' +
            '<p>' + esc(row.name || "Passenger") + (row.phone ? " · " + esc(row.phone) : "") + '</p></div></div>' +
          '<div class="frs-hero-tools">' + statusChip(row) + ticketBtn(row.booking_id, "frs-btn soft") +
            '<button type="button" class="frs-btn icon" data-close aria-label="Close">' + svg('<path d="M6 6l12 12M18 6L6 18"/>') + '</button></div>' +
        '</div>' +
        '<div class="frs-hero-amt"><span>Amount to pay</span><b>' + esc(money(api, refundAmt(row))) + '</b></div>' +
        timeline(row) +
      '</header>' +
      '<div class="frs-body">' +
        '<div class="frs-col">' +
          '<section class="frs-card">' +
            '<div class="frs-card-h"><strong>Booking</strong><span>' + esc(title) + '</span></div>' +
            '<div class="frs-facts">' +
              fact("Route", row.route) +
              fact("Departure", day(row.depart_at)) +
              fact("Original payment", row.payment_method) +
              fact("Paid on booking", money(api, row.paid_amount)) +
              fact("Approval rule", row.needs_approval
                ? ("Required · " + money(api, isFinite(thr) ? thr : 2000))
                : ("Not required · under " + money(api, isFinite(thr) ? thr : 2000))) +
              fact("Stage", row.stage === "ops" ? "With Operations" : row.stage === "finance" ? "With Finance" : row.stage === "done" ? "Paid" : row.stage) +
            '</div>' +
          '</section>' +
          noteCard("Cancellation reason", esc(row.reason || "—")) +
          noteCard("Operations", row.ops_by
            ? esc(row.ops_by) + (row.ops_at ? " · " + esc(when(row.ops_at)) : "") + (row.ops_note ? "<br>" + esc(row.ops_note) : "")
            : (row.stage === "ops" ? "Waiting for the Operations head." : ""), "ops") +
          noteCard("Finance approval", (row.finance_approved_by || row.finance_approved_at)
            ? esc(row.finance_approved_by || "Finance") + (row.finance_approved_at ? " · " + esc(when(row.finance_approved_at)) : "") + (row.finance_approve_note ? "<br>" + esc(row.finance_approve_note) : "")
            : "", "ok") +
          noteCard("Marked paid", row.finance_by
            ? esc(row.finance_by) + (row.finance_at ? " · " + esc(when(row.finance_at)) : "") +
              (row.payout_method ? "<br>Payout: " + esc(row.payout_method) + (row.payout_ref ? " · " + esc(row.payout_ref) : "") : "") +
              (row.finance_note ? "<br>" + esc(row.finance_note) : "")
            : "", "paid") +
        '</div>' +
        '<div class="frs-col action">' + actionPanel + '</div>' +
      '</div>' +
      foot +
    '</div>';
  }

  function render(api) {
    var tab = api.tab || "waiting";
    api.board = api.board || emptyBoard();
    ["waiting", "ops", "records", "rejected"].forEach(function (k) {
      if (!Array.isArray(api.board[k])) api.board[k] = [];
    });
    var body = tab === "ops" ? opsRows(api) : tab === "done" ? doneRows(api) : tab === "rejected" ? rejectedRows(api) : waitingRows(api);
    return '<div class="fr">' +
      kpis(api) +
      '<section class="fin-card fr-card">' +
        '<div class="fin-card-head"><div><h2>Refunds</h2><p class="note">Approve when required, attach proof, then mark paid. Ticket income stays on the overview until payout is confirmed.</p></div></div>' +
        tabs(api) + toolbar(api) + body +
      '</section></div>';
  }

  function bind(api, redraw) {
    var root = document.getElementById("fin");
    if (!root) return;
    [].forEach.call(root.querySelectorAll("[data-fr-tab]"), function (b) {
      b.addEventListener("click", function () { api.tab = b.getAttribute("data-fr-tab"); redraw(); });
    });
    [].forEach.call(root.querySelectorAll("[data-fr-wfilt]"), function (b) {
      b.addEventListener("click", function () { api.waitFilter = b.getAttribute("data-fr-wfilt"); redraw(); });
    });
    var q = document.getElementById("frQ");
    if (q) {
      q.addEventListener("input", function () {
        clearTimeout(api._qT);
        api._qT = setTimeout(function () { api.q = q.value.trim().toLowerCase(); redraw(); }, 160);
      });
    }
    var refresh = document.getElementById("frRefresh");
    if (refresh) refresh.addEventListener("click", function () {
      refresh.disabled = true;
      load(api).then(function () { refresh.disabled = false; redraw(); }, function (e) {
        refresh.disabled = false;
        window.alert(e.message || "Could not refresh refunds.");
      });
    });

    function refreshRowModal(id, list) {
      return load(api).then(function () {
        redraw();
        var row = findRow(api, id, list || "waiting");
        if (row) openDetail(id, list || "waiting");
        else if (api.closeModal) api.closeModal();
      });
    }

    function openTicket(bookingId) {
      if (!bookingId) return;
      if (!window.VeyoraFinTickets || !window.VeyoraFinTickets.openTicket) {
        window.alert("Tickets module failed to load.");
        return;
      }
      window.VeyoraFinTickets.openTicket({
        db: api.db,
        company: api.company,
        money: api.money
      }, bookingId).catch(function () {});
    }
    function openDetail(id, list) {
      payBusy = false;
      var row = findRow(api, id, list || "waiting");
      api.openModal(detailHtml(api, row, list || "waiting"), "fr-modal fr-sheet");
      var card = document.getElementById("modalCard");
      if (!card) return;
      var drop = document.getElementById("frDrop");
      var file = document.getElementById("frProof");
      if (row && list === "waiting") {
        var lastProof = proofsOf(row).slice().reverse().filter(function (p) { return ocrOf(p); })[0];
        if (lastProof) showOcrPanel(ocrOf(lastProof), row);
      }
      if (drop && file) {
        ["dragenter", "dragover"].forEach(function (ev) {
          drop.addEventListener(ev, function (e) { e.preventDefault(); e.stopPropagation(); drop.classList.add("over"); });
        });
        ["dragleave", "drop"].forEach(function (ev) {
          drop.addEventListener(ev, function (e) {
            e.preventDefault(); e.stopPropagation(); drop.classList.remove("over");
            if (ev === "drop" && e.dataTransfer && e.dataTransfer.files && e.dataTransfer.files[0]) {
              uploadProof(id, e.dataTransfer.files[0]);
            }
          });
        });
        file.addEventListener("change", function () {
          if (!file.files || !file.files[0]) return;
          uploadProof(id, file.files[0]).finally(function () { file.value = ""; });
        });
      }
      [].forEach.call(card.querySelectorAll("[data-fr-pay]"), function (b) {
        b.addEventListener("click", function (e) {
          e.preventDefault();
          e.stopPropagation();
          doPay(b.getAttribute("data-fr-pay"));
        });
      });
      card.onclick = function (e) {
        var dec = e.target.closest("[data-fr-decline]");
        var appr = e.target.closest("[data-fr-approve]");
        var openP = e.target.closest("[data-fr-openproof]");
        var rmP = e.target.closest("[data-fr-rmproof]");
        var tick = e.target.closest("[data-fr-ticket]");
        if (dec) { e.preventDefault(); doDecline(dec.getAttribute("data-fr-decline")); }
        if (appr) { e.preventDefault(); doApprove(appr.getAttribute("data-fr-approve")); }
        if (openP) { e.preventDefault(); openProof(openP.getAttribute("data-fr-openproof")); }
        if (rmP) { e.preventDefault(); removeProof(rmP.getAttribute("data-fr-rmproof"), rmP.getAttribute("data-path")); }
        if (tick) { e.preventDefault(); e.stopPropagation(); openTicket(tick.getAttribute("data-fr-ticket")); }
      };
    }

    function openProof(path) {
      api.db.storage.from(BUCKET).createSignedUrl(path, 300).then(function (r) {
        if (r.error || !r.data) throw new Error((r.error && r.error.message) || "Could not open proof.");
        window.open(r.data.signedUrl, "_blank", "noopener");
      }).catch(function (e) { window.alert(e.message || "Could not open proof."); });
    }

    function slipLib() {
      if (window.VeyoraSlip) return Promise.resolve(window.VeyoraSlip);
      return new Promise(function (ok, fail) {
        var s = document.createElement("script");
        s.src = "slip-ocr.js?v=20261107ocr1";
        s.onload = function () { window.VeyoraSlip ? ok(window.VeyoraSlip) : fail(new Error("Slip reader did not load.")); };
        s.onerror = function () { fail(new Error("Could not load the slip reader.")); };
        document.head.appendChild(s);
      });
    }
    function setScanProgress(p) {
      var box = document.getElementById("frScan");
      if (!box) return;
      if (p == null) { box.hidden = true; return; }
      box.hidden = false;
      var bar = box.querySelector("i");
      if (bar) bar.style.width = Math.round(Math.max(0.04, p) * 100) + "%";
      var lab = box.querySelector("span");
      if (lab) lab.textContent = p >= 1 ? "Scan complete" : "Scanning document… " + Math.round(p * 100) + "%";
    }
    function showOcrPanel(fields, row) {
      var box = document.getElementById("frOcrBox");
      if (!box) return;
      fields = fields || {};
      var due = refundAmt(row || {});
      var amt = fields.amount != null && fields.amount !== "" ? Number(fields.amount) : null;
      var amtNote = "";
      if (amt != null && isFinite(amt) && due > 0) {
        var diff = Math.abs(amt - due);
        if (diff < 0.05) amtNote = '<em class="ok">Matches refund amount</em>';
        else amtNote = '<em class="warn">Slip ' + esc(String(amt)) + ' · refund due ' + esc(String(due)) + '</em>';
      }
      var rows = [
        ["Bank", fields.bank || "—"],
        ["Status", fields.status || "—"],
        ["Amount", (fields.currency ? fields.currency + " " : "") + (fields.amount || "—")],
        ["Reference", fields.reference_no || "—"],
        ["Date", fields.transaction_date || "—"],
        ["From", fields.from_name || fields.from_account || "—"],
        ["To", fields.to_name || fields.to_account || "—"]
      ];
      var hasAny = !!(fields.amount || fields.reference_no || fields.bank || fields.to_account || fields.status);
      box.hidden = false;
      box.innerHTML = '<div class="frs-ocr-h"><strong>Scanned from document</strong>' +
        (hasAny ? '<span class="frs-ocr-tag">Auto-filled</span>' : '<span class="frs-ocr-tag mute">Could not read clearly</span>') + '</div>' +
        '<div class="frs-ocr-grid">' + rows.map(function (r) {
          return '<div><small>' + esc(r[0]) + '</small><b>' + esc(r[1]) + '</b></div>';
        }).join("") + '</div>' + (amtNote || "");
    }
    function applyOcrToForm(fields) {
      if (!fields) return;
      var refEl = document.getElementById("frRef");
      var methodEl = document.getElementById("frMethod");
      var noteEl = document.getElementById("frNote");
      if (refEl && fields.reference_no && !String(refEl.value || "").trim()) refEl.value = fields.reference_no;
      if (methodEl && (fields.bank || fields.reference_no || fields.to_account)) {
        var want = "Bank transfer";
        for (var i = 0; i < methodEl.options.length; i++) {
          if (methodEl.options[i].value === want) { methodEl.value = want; break; }
        }
      }
      if (noteEl && !String(noteEl.value || "").trim()) {
        var bits = [];
        if (fields.bank) bits.push(fields.bank);
        if (fields.amount) bits.push((fields.currency || "") + " " + fields.amount);
        if (fields.from_name) bits.push("from " + fields.from_name);
        if (fields.transaction_date) bits.push(String(fields.transaction_date).slice(0, 16));
        if (bits.length) noteEl.value = "Slip scan: " + bits.join(" · ");
      }
    }
    function scanFile(file, row) {
      if (!file || !/^image\/(png|jpeg|webp|heic)$/i.test(file.type || "")) return Promise.resolve(null);
      setScanProgress(0.05);
      return slipLib().then(function (L) {
        return L.read(file, function (p) { setScanProgress(Math.max(0.05, p)); });
      }).then(function (res) {
        setScanProgress(1);
        var fields = (res && res.fields) || {};
        applyOcrToForm(fields);
        showOcrPanel(fields, row);
        setTimeout(function () { setScanProgress(null); }, 500);
        return fields;
      }, function () {
        setScanProgress(null);
        return null;
      });
    }
    function uploadProof(id, file) {
      if (!file) return Promise.resolve();
      if (file.size > 10 * 1024 * 1024) { window.alert("Proof files must be 10 MB or smaller."); return Promise.resolve(); }
      var row = findRow(api, id, "waiting");
      var safe = String(file.name || "proof").replace(/[^\w.\-]+/g, "_").slice(0, 80);
      var path = api.company.id + "/" + id + "/" + Date.now() + "-" + safe;
      var drop = document.getElementById("frDrop");
      if (drop) drop.classList.add("busy");
      return scanFile(file, row).then(function (fields) {
        return api.db.storage.from(BUCKET).upload(path, file, { contentType: file.type || undefined, upsert: false }).then(function (up) {
          if (up.error) throw new Error(up.error.message);
          return api.db.rpc("attach_refund_proof", {
            p_id: id,
            p_path: path,
            p_name: file.name || safe,
            p_size: file.size || null,
            p_ocr: fields || {}
          });
        });
      }).then(function (r) {
        if (r.error) throw new Error(r.error.message);
        if (drop) drop.classList.remove("busy");
        return refreshRowModal(id, "waiting");
      }).catch(function (e) {
        if (drop) drop.classList.remove("busy");
        setScanProgress(null);
        window.alert(e.message || "Could not upload proof.");
      });
    }

    function removeProof(id, path) {
      if (!window.confirm("Remove this proof file?")) return;
      api.db.rpc("remove_refund_proof", { p_id: id, p_path: path }).then(function (r) {
        if (r.error) throw new Error(r.error.message);
        return api.db.storage.from(BUCKET).remove([path]).catch(function () {});
      }).then(function () { return refreshRowModal(id, "waiting"); })
        .catch(function (e) { window.alert(e.message || "Could not remove proof."); });
    }

    function doApprove(id) {
      var noteEl = document.getElementById("frNote");
      var note = noteEl ? noteEl.value : null;
      if (!window.confirm("Approve this refund? Mark paid will unlock after approval.")) return;
      api.db.rpc("approve_booking_refund", { p_id: id, p_note: note || null }).then(function (r) {
        if (r.error) throw new Error(r.error.message);
        return refreshRowModal(id, "waiting");
      }).catch(function (e) { window.alert(e.message || "Could not approve the refund."); });
    }

    var payBusy = false;
    function payConfirmHtml(row, method, ref) {
      var amt = money(api, refundAmt(row));
      var proofs = proofsOf(row).length;
      return '<div class="fr-confirm-solo" id="frPayConfirm">' +
        '<div class="fr-confirm-card on">' +
          '<div class="fr-confirm-hero">' +
            '<span class="fr-confirm-ic" aria-hidden="true">' + svg(IC.pay) + '</span>' +
            '<div><p class="fr-confirm-kicker">Confirm payout</p>' +
            '<h3 id="frPayConfirmTitle">Mark this refund paid?</h3></div>' +
          '</div>' +
          '<div class="fr-confirm-amt"><span>Finance totals will update by</span><b>' + esc(amt) + '</b></div>' +
          '<ul class="fr-confirm-facts">' +
            '<li><small>Passenger</small><strong>' + esc(row.name || "Passenger") + '</strong></li>' +
            '<li><small>Booking</small><strong>' + esc(row.reference || "—") + '</strong></li>' +
            '<li><small>Payout method</small><strong>' + esc(method) + '</strong></li>' +
            '<li><small>Reference</small><strong>' + esc(ref || "—") + '</strong></li>' +
          '</ul>' +
          '<div class="fr-confirm-note">' +
            '<i aria-hidden="true">' + svg(IC.spark) + '</i>' +
            '<p>Finance totals change only after you confirm. ' +
              (proofs ? proofs + " proof file" + (proofs === 1 ? "" : "s") + " stay on this record." : "You can still attach proof later from Paid.") +
            '</p>' +
          '</div>' +
          '<div class="fr-confirm-acts">' +
            '<button type="button" class="frs-btn ghost" id="frPayBack">Not yet</button>' +
            '<button type="button" class="frs-btn primary pay" id="frPayYes">' + svg(IC.check) + '<span>Yes, mark paid</span></button>' +
          '</div>' +
        '</div>' +
      '</div>';
    }

    function doPay(id) {
      if (payBusy) return;
      var row = findRow(api, id, "waiting");
      if (!row) { window.alert("This refund is no longer waiting for Finance."); return; }
      if (needsApprove(row)) { window.alert("This refund still needs Finance approval."); return; }
      var methodEl = document.getElementById("frMethod");
      var refEl = document.getElementById("frRef");
      var noteEl = document.getElementById("frNote");
      var method = methodEl ? String(methodEl.value || "").trim() : "";
      if (!method) { window.alert("Choose how the refund was paid out."); return; }
      var pref = refEl && refEl.value ? String(refEl.value).trim() : "";
      var noteVal = noteEl ? (noteEl.value || null) : null;

      api.openModal(payConfirmHtml(row, method, pref), "fr-modal fr-confirm-modal");
      var back = document.getElementById("frPayBack");
      var yes = document.getElementById("frPayYes");
      if (back) {
        back.onclick = function (e) {
          e.preventDefault();
          openDetail(id, "waiting");
        };
      }
      if (yes) {
        yes.focus();
        yes.onclick = function (e) {
          e.preventDefault();
          if (payBusy) return;
          payBusy = true;
          yes.disabled = true;
          yes.innerHTML = svg(IC.check) + "<span>Confirming…</span>";
          api.db.rpc("process_booking_refund", {
            p_id: id,
            p_note: noteVal,
            p_method: method,
            p_ref: pref || null
          }).then(function (r) {
            if (r.error) throw new Error(r.error.message);
            return load(api);
          }).then(function () {
            payBusy = false;
            if (api.closeModal) api.closeModal();
            api.tab = "done";
            redraw();
            if (api.onChanged) api.onChanged();
          }).catch(function (err) {
            payBusy = false;
            yes.disabled = false;
            yes.innerHTML = svg(IC.check) + "<span>Yes, mark paid</span>";
            window.alert(err.message || "Could not finish the refund.");
          });
        };
      }
    }

    function doDecline(id) {
      var noteEl = document.getElementById("frNote");
      var note = noteEl ? noteEl.value.trim() : "";
      if (!note) { window.alert("Add a note explaining why Finance cannot pay this refund."); return; }
      if (!window.confirm("Decline this refund? The booking stays cancelled and Finance totals do not change.")) return;
      api.db.rpc("decline_booking_refund", { p_id: id, p_note: note }).then(function (r) {
        if (r.error) throw new Error(r.error.message);
        return load(api);
      }).then(function () {
        if (api.closeModal) api.closeModal();
        api.tab = "rejected";
        redraw();
      }).catch(function (e) { window.alert(e.message || "Could not decline the refund."); });
    }

    [].forEach.call(root.querySelectorAll(".frc"), function (card) {
      card.addEventListener("click", function (e) {
        if (e.target.closest("button")) return;
        openDetail(card.getAttribute("data-fr-view"), card.getAttribute("data-fr-list") || "waiting");
      });
      card.addEventListener("keydown", function (e) {
        if (e.key === "Enter" || e.key === " ") {
          e.preventDefault();
          openDetail(card.getAttribute("data-fr-view"), card.getAttribute("data-fr-list") || "waiting");
        }
      });
    });
    [].forEach.call(root.querySelectorAll("button[data-fr-view]"), function (b) {
      b.addEventListener("click", function (e) {
        e.stopPropagation();
        openDetail(b.getAttribute("data-fr-view"), b.getAttribute("data-fr-list") || "waiting");
      });
    });
    [].forEach.call(root.querySelectorAll("[data-fr-ticket]"), function (b) {
      b.addEventListener("click", function (e) {
        e.preventDefault();
        e.stopPropagation();
        openTicket(b.getAttribute("data-fr-ticket"));
      });
    });
  }

  window.VeyoraFinRefunds = { load: load, render: render, bind: bind, emptyBoard: emptyBoard };
})();
