/* Passengers: registry from booking_passengers + bookings (payment status), check-in, boarding.
   Page: passengers.html — see supabase/DATABASE_HANDOFF.md §3.8
   Cursor 2026-10-23: day + schedule (trip) selectors filter the list.
   Cursor 2026-10-23: custom schedule dropdown UI (rich trip rows).
   Cursor 2026-10-23: schedule pick filters in-place (no Loading blank). */
(function () {
  var db = window.veyoraDb;
  var esc = window.VeyoraShell.esc;
  var $ = function (id) { return document.getElementById(id); };
  var company = null, canEdit = false, canSet = false;
  var tab = "all", q = "", statusF = "", payF = "";
  var dayF = null;   // YYYY-MM-DD, default today
  var tripF = "";    // trip id or ""
  var passengers = [];
  var trips = [];    // sailings on dayF
  var boarding = [];
  var schedOpen = false;

  function icon(p) { return '<svg viewBox="0 0 24 24">' + p + '</svg>'; }
  var I = {
    people: '<path d="M12 12a4 4 0 1 0 0-8 4 4 0 0 0 0 8ZM4 21c0-4 4-6 8-6s8 2 8 6"/>',
    ticket: '<path d="M4 8h16v3a2 2 0 0 0 0 4v3H4v-3a2 2 0 0 0 0-4V8Z"/><path d="M9 8v12"/>',
    check: '<path d="m5 12 5 5 9-10"/>',
    clock: '<circle cx="12" cy="12" r="9"/><path d="M12 7v5l3 2"/>',
    plus: '<path d="M12 5v14M5 12h14"/>',
    search: '<circle cx="11" cy="11" r="7"/><path d="m20 20-3.5-3.5"/>',
    download: '<path d="M12 4v12M8 12l4 4 4-4M4 20h16"/>',
    list: '<path d="M8 6h12M8 12h12M8 18h12M4 6h.01M4 12h.01M4 18h.01"/>',
    shield: '<path d="M12 3 4 6v6c0 4.5 3.3 7.8 8 9 4.7-1.2 8-4.5 8-9V6l-8-3Z"/>',
    hist: '<circle cx="12" cy="12" r="9"/><path d="M12 7v5l3 2"/>',
    more: '<circle cx="12" cy="5" r="1.5"/><circle cx="12" cy="12" r="1.5"/><circle cx="12" cy="19" r="1.5"/>',
    chev: '<path d="m6 9 6 6 6-6"/>',
    ship: '<path d="M3 17l2-7 7-3 7 3 2 7H3Z"/><path d="M5 17c1.2 1.5 3.2 2.5 7 2.5s5.8-1 7-2.5"/><path d="M12 7V4"/>'
  };
  function slug(t) { return String(t || "").toLowerCase().replace(/[^a-z0-9]+/g, "-").replace(/^-|-$/g, ""); }
  function chip(text, cls) { return '<span class="chip ' + (cls || "st-" + slug(text)) + '">' + esc(text) + '</span>'; }
  function payChip(s) {
    var st = s || "Unpaid";
    var cls = st === "Paid" ? "st-paid" : st === "Partly paid" || st === "Refund due" ? "st-partly" : st === "Refunded" ? "st-refunded" : "st-unpaid";
    return chip(st, cls);
  }
  function fmtNum(n) {
    n = Number(n) || 0;
    return n >= 1000 ? n.toLocaleString("en-GB") : String(n).padStart(2, "0");
  }
  function pad2(n) { return n < 10 ? "0" + n : String(n); }
  function iso(d) { return d.getFullYear() + "-" + pad2(d.getMonth() + 1) + "-" + pad2(d.getDate()); }
  function todayIso() { return iso(new Date()); }
  function addDays(s, n) { var d = new Date(s + "T00:00:00"); d.setDate(d.getDate() + n); return iso(d); }
  function fmtTime(ts) {
    if (!ts) return "";
    var d = new Date(ts);
    return pad2(d.getHours()) + ":" + pad2(d.getMinutes());
  }

  function routeLabel(t) {
    var rt = (t && t.routes) || {};
    return [rt.origin, rt.destination].filter(Boolean).join(" → ") || rt.name || (t && t.code) || "—";
  }
  function mapPassenger(r) {
    var b = r.bookings || {}, t = r.trips || {};
    var day = t.depart_at ? iso(new Date(t.depart_at)) : "";
    return {
      id: r.id,
      bookingId: r.booking_id,
      name: r.full_name,
      document: r.id_number || "",
      phone: r.phone || b.contact_phone || "",
      category: r.category || "Adult",
      status: r.status || "Booked",
      bookingStatus: b.status || "",
      payment: b.payment_status || "Unpaid",
      ticket: b.reference || "",
      nextTrip: routeLabel(t),
      nextTime: t.depart_at ? (fmtTime(t.depart_at) + (t.code ? " · " + t.code : "")) : "",
      day: day,
      tripId: r.trip_id
    };
  }

  function load() {
    if (!dayF) dayF = todayIso();
    var day = dayF, next = addDays(day, 1);
    return db.from("trips")
      .select("id, code, kind, depart_at, seats_booked, seats_total, status, routes(name, origin, destination)")
      .eq("company_id", company.id)
      .gte("depart_at", day + "T00:00:00")
      .lt("depart_at", next + "T00:00:00")
      .order("depart_at")
      .then(function (res) {
        if (res.error) throw new Error(res.error.message);
        trips = (res.data || []).filter(function (t) { return t.status !== "Cancelled"; });
        if (tripF && !trips.some(function (t) { return t.id === tripF; })) tripF = "";
        boarding = trips.map(function (t) {
          return {
            id: t.id,
            route: routeLabel(t),
            time: fmtTime(t.depart_at),
            booked: t.seats_booked || 0,
            capacity: t.seats_total != null ? t.seats_total : 0
          };
        });
        // Always load the whole day; schedule filter is client-side (instant).
        var ids = trips.map(function (t) { return t.id; });
        if (!ids.length) { passengers = []; return; }
        return db.from("booking_passengers")
          .select("id, full_name, category, id_number, phone, status, trip_id, booking_id, fare, created_at, bookings(reference, payment_status, status, contact_phone, paid_amount, fare_total), trips(code, depart_at, seats_booked, seats_total, status, routes(name, origin, destination))")
          .eq("company_id", company.id)
          .in("trip_id", ids)
          .order("created_at", { ascending: false })
          .limit(500)
          .then(function (pax) {
            if (pax.error) throw new Error(pax.error.message);
            passengers = (pax.data || []).map(mapPassenger);
          });
      });
  }

  function kpis() {
    var pool = passengers.filter(function (p) {
      if (p.status === "Cancelled") return false;
      if (tripF && p.tripId !== tripF) return false;
      return true;
    });
    var confirmed = pool.filter(function (p) {
      return p.bookingStatus === "Confirmed" || p.status === "Booked" || p.status === "Checked in" || p.status === "Boarded";
    }).length;
    var checked = pool.filter(function (p) { return p.status === "Checked in" || p.status === "Boarded"; }).length;
    var awaiting = pool.filter(function (p) { return p.status === "Booked"; }).length;
    var dayLabel = dayF === todayIso() ? "today" : dayF;
    return {
      today: pool.length,
      todaySub: pool.length ? (tripF ? "On selected schedule" : "On " + dayLabel) : ("No passengers on " + (tripF ? "this schedule" : dayLabel)),
      confirmed: confirmed, confSub: "Active bookings",
      checked: checked, checkedSub: "Checked in or boarded",
      awaiting: awaiting, awaitSub: "Still to check in"
    };
  }

  function filtered() {
    return passengers.filter(function (p) {
      if (tab === "bookings" && !p.bookingId) return false;
      if (tab === "checkin" && p.status !== "Checked in" && p.status !== "Booked") return false;
      if (tab === "manifests") return false;
      if (tripF && p.tripId !== tripF) return false;
      if (statusF && p.status !== statusF) return false;
      if (payF && p.payment !== payF) return false;
      if (q) {
        var hay = ((p.name || "") + " " + (p.document || "") + " " + (p.phone || "") + " " + (p.ticket || "") + " " + (p.nextTrip || "")).toLowerCase();
        if (hay.indexOf(q.toLowerCase()) < 0) return false;
      }
      return true;
    });
  }

  function emptyBlock() {
    var labels = {
      all: "No passengers yet",
      bookings: "No bookings yet",
      checkin: "No one awaiting check-in",
      manifests: "Open a trip in Operations for the full manifest"
    };
    return '<div class="pax-empty"><span class="ic">' + icon(I.people) + '</span>' +
      '<h3>' + esc(labels[tab] || "No passengers") + '</h3>' +
      '<p>' + (tab === "manifests"
        ? "Trip manifests live on each trip in Operations → Passengers."
        : "Book passengers from Operations (trip detail → Passengers → Add new passenger), or add a registry record here.") + '</p>' +
      '<div class="acts">' +
        (canEdit && tab !== "manifests" ? '<button type="button" class="primary-btn" id="emptyNew">' + icon(I.plus) + ' Add passenger</button>' : "") +
        '<a class="btn-soft" href="operations.html">Open Operations</a>' +
      '</div></div>';
  }

  function row(p) {
    var initials = (p.name || "?").split(/\s+/).filter(Boolean).map(function (w) { return w[0]; }).join("").slice(0, 2).toUpperCase() || "?";
    return '<div class="pax-row">' +
      '<div class="who"><span class="av">' + esc(initials) + '</span><div><strong>' + esc(p.name) + '</strong>' +
        (p.category ? '<small>' + esc(p.category) + '</small>' : "") + '</div></div>' +
      '<div class="doc">' + esc(p.document || "—") + '</div>' +
      '<div class="phone">' + esc(p.phone || "—") + '</div>' +
      '<div class="trip"><strong>' + esc(p.nextTrip || "—") + '</strong>' + (p.nextTime ? '<small>' + esc(p.nextTime) + '</small>' : "") + '</div>' +
      '<div class="pay">' + payChip(p.payment) + '</div>' +
      '<div>' + chip(p.status || "Booked") + '</div>' +
      (p.tripId
        ? '<a class="more" href="operations.html" title="Open Operations" aria-label="Open Operations">' + icon(I.more) + '</a>'
        : '<button type="button" class="more" aria-label="Passenger actions" disabled>' + icon(I.more) + '</button>') +
      '</div>';
  }

  function boardingBlock() {
    var list = tripF ? boarding.filter(function (b) { return b.id === tripF; }) : boarding;
    if (!list.length) return '<div class="empty-side">No sailings on this day.</div>';
    return '<div class="pax-board">' + list.map(function (b) {
      var pct = b.capacity ? Math.min(100, Math.round((b.booked / b.capacity) * 100)) : 0;
      var on = tripF && b.id === tripF;
      return '<button type="button" class="pax-bitem' + (on ? " on" : "") + '" data-pick-trip="' + esc(b.id) + '">' +
        '<div class="lab"><strong>' + esc((b.time ? b.time + " · " : "") + b.route) + '</strong><span>' + esc(b.booked + " / " + (b.capacity || "—")) + '</span></div>' +
        '<div class="pax-bar" aria-hidden="true"><i style="width:' + pct + '%"></i></div></button>';
    }).join("") + '</div>';
  }

  function kindCls(k) {
    var s = String(k || "").toLowerCase();
    if (s.indexOf("promo") >= 0) return "kind-promo";
    if (s.indexOf("temp") >= 0) return "kind-temp";
    if (s.indexOf("season") >= 0) return "kind-season";
    if (s.indexOf("charter") >= 0) return "kind-charter";
    return "kind-fixed";
  }
  function seatsMeta(t) {
    var booked = t.seats_booked || 0;
    var cap = t.seats_total != null ? t.seats_total : 0;
    var pct = cap ? Math.min(100, Math.round((booked / cap) * 100)) : 0;
    return { booked: booked, cap: cap, pct: pct, label: booked + " / " + (cap || "—") };
  }
  function scheduleTriggerLabel() {
    if (!tripF) {
      return {
        time: trips.length ? String(trips.length) : "—",
        title: trips.length ? "All schedules" : "No sailings",
        sub: trips.length ? trips.length + " sailing" + (trips.length === 1 ? "" : "s") + " today" : "Pick another day",
        all: true
      };
    }
    var t = trips.filter(function (x) { return x.id === tripF; })[0];
    if (!t) {
      return { time: "—", title: "Schedule", sub: "Not on this day", all: true };
    }
    var s = seatsMeta(t);
    return {
      time: fmtTime(t.depart_at) || "—",
      title: routeLabel(t),
      sub: (t.code ? t.code + " · " : "") + s.label + " seats" + (t.kind && String(t.kind).toLowerCase() !== "fixed" ? " · " + t.kind : ""),
      all: false
    };
  }
  // Cursor 2026-10-23: custom schedule picker — time pill, route, seats bar, kind chip.
  function schedulePickerHtml() {
    var trig = scheduleTriggerLabel();
    var rows = '<button type="button" class="pax-sd-opt' + (!tripF ? " on" : "") + '" data-sched="" role="option" aria-selected="' + (!tripF ? "true" : "false") + '">' +
      '<span class="pax-sd-time all">' + icon(I.list) + '</span>' +
      '<span class="pax-sd-body"><strong>All schedules</strong><small>' + esc(trips.length ? trips.length + " sailing" + (trips.length === 1 ? "" : "s") + " on this day" : "No sailings on this day") + '</small></span>' +
      (!tripF ? '<span class="pax-sd-check" aria-hidden="true">' + icon(I.check) + '</span>' : "") +
      '</button>';
    rows += trips.map(function (t) {
      var s = seatsMeta(t);
      var on = tripF === t.id;
      var kind = t.kind || "Fixed";
      return '<button type="button" class="pax-sd-opt' + (on ? " on" : "") + '" data-sched="' + esc(t.id) + '" role="option" aria-selected="' + (on ? "true" : "false") + '">' +
        '<span class="pax-sd-time">' + esc(fmtTime(t.depart_at) || "—") + '</span>' +
        '<span class="pax-sd-body">' +
          '<strong>' + esc(routeLabel(t)) + '</strong>' +
          '<small>' +
            (t.code ? '<span class="pax-sd-code">' + esc(t.code) + '</span>' : "") +
            '<span class="pax-sd-kind ' + kindCls(kind) + '">' + esc(kind) + '</span>' +
            '<span>' + esc(s.label) + ' seats</span>' +
          '</small>' +
          '<span class="pax-sd-bar" aria-hidden="true"><i style="width:' + s.pct + '%"></i></span>' +
        '</span>' +
        (on ? '<span class="pax-sd-check" aria-hidden="true">' + icon(I.check) + '</span>' : "") +
      '</button>';
    }).join("");
    return '<div class="pax-sched' + (schedOpen ? " open" : "") + (trig.all && trips.length ? "" : tripF ? " has-sel" : "") + '" id="paxSched">' +
      '<span class="pax-sched-lab">Schedule</span>' +
      '<button type="button" class="pax-sd-btn" id="paxTripBtn" aria-haspopup="listbox" aria-expanded="' + (schedOpen ? "true" : "false") + '" aria-label="Schedule">' +
        '<span class="pax-sd-time' + (trig.all ? " all" : "") + '">' + (trig.all ? icon(I.ship) : esc(trig.time)) + '</span>' +
        '<span class="pax-sd-txt"><strong>' + esc(trig.title) + '</strong><small>' + esc(trig.sub) + '</small></span>' +
        '<span class="pax-sd-chev" aria-hidden="true">' + icon(I.chev) + '</span>' +
      '</button>' +
      '<div class="pax-sd-panel" id="paxTripPanel" role="listbox" aria-label="Schedules"' + (schedOpen ? "" : " hidden") + '>' +
        '<div class="pax-sd-head"><span>Sailings</span><span>' + esc(String(trips.length)) + '</span></div>' +
        '<div class="pax-sd-list">' + rows + '</div>' +
      '</div>' +
    '</div>';
  }

  function rpc(name, args) { return db.rpc(name, args).then(function (r) { if (r.error) throw new Error(r.error.message); return r.data; }); }
  function render() {
    if ((location.hash || "").indexOf("#settings") === 0) {
      $("paxActions").innerHTML = '<a class="btn-soft" href="#">Passengers</a>';
      $("pax").innerHTML = '<section class="dash-card" id="pageSettings"></section>';
      if (window.PageSettings) window.PageSettings.mount($("pageSettings"), {
        area: "passengers", pill: (location.hash || "").slice(1).split("/")[1] || "", esc: esc,
        company: function () { return company; }, db: db, rpc: rpc, canEdit: canSet
      });
      return;
    }
    var k = kpis();
    var list = filtered();
    var statuses = ["Booked", "Checked in", "Boarded", "No-show", "Cancelled"];
    var pays = ["Paid", "Partly paid", "Unpaid", "Refund due", "Refunded"];

    $("paxActions").innerHTML = (canEdit
      ? '<button type="button" class="primary-btn" id="paxNew">' + icon(I.plus) + ' Add passenger</button>'
      : "") + '<a class="btn-soft" href="#settings">Settings</a>';

    $("pax").innerHTML =
      '<div class="pax-kpis">' +
        '<div class="pax-kpi"><span class="tile tone-blue">' + icon(I.people) + '</span><div><small>Passengers today</small><strong>' + fmtNum(k.today) + '</strong><span class="sub">' + esc(k.todaySub) + '</span></div></div>' +
        '<div class="pax-kpi"><span class="tile tone-green">' + icon(I.ticket) + '</span><div><small>Active bookings</small><strong>' + fmtNum(k.confirmed) + '</strong><span class="sub">' + esc(k.confSub) + '</span></div></div>' +
        '<div class="pax-kpi"><span class="tile tone-purple">' + icon(I.check) + '</span><div><small>Checked in</small><strong>' + fmtNum(k.checked) + '</strong><span class="sub">' + esc(k.checkedSub) + '</span></div></div>' +
        '<div class="pax-kpi"><span class="tile tone-amber">' + icon(I.clock) + '</span><div><small>Awaiting check-in</small><strong>' + fmtNum(k.awaiting) + '</strong><span class="sub">' + esc(k.awaitSub) + '</span></div></div>' +
      '</div>' +
      '<div class="pax-layout"><section class="pax-main">' +
        '<div class="card-head"><div><h2>Passenger list</h2><p class="note">Bookings with payment status. Add walk-ups from Operations trip detail.</p></div></div>' +
        '<div class="pax-tabs">' +
          [["all", "All passengers"], ["bookings", "Bookings"], ["checkin", "Check-in"], ["manifests", "Trip manifests"]].map(function (t) {
            return '<button type="button" class="' + (tab === t[0] ? "on" : "") + '" data-tab="' + t[0] + '">' + t[1] + '</button>';
          }).join("") +
        '</div>' +
        (tab === "manifests" ? emptyBlock() :
          '<div class="pax-filters">' +
            '<label class="pax-day" title="Sailing day">' +
              '<span>Day</span>' +
              '<input type="date" id="paxDay" value="' + esc(dayF || todayIso()) + '" aria-label="Sailing day">' +
            '</label>' +
            schedulePickerHtml() +
            '<label class="fsearch">' + icon(I.search) + '<input type="search" id="paxQ" placeholder="Search name, ticket or ID" value="' + esc(q) + '" aria-label="Search passengers"></label>' +
            '<select id="paxStatus" aria-label="Boarding status"><option value="">All statuses</option>' +
              statuses.map(function (s) { return '<option value="' + esc(s) + '"' + (statusF === s ? " selected" : "") + '>' + esc(s) + '</option>'; }).join("") +
            '</select>' +
            '<select id="paxPay" aria-label="Payment status"><option value="">All payments</option>' +
              pays.map(function (s) { return '<option value="' + esc(s) + '"' + (payF === s ? " selected" : "") + '>' + esc(s) + '</option>'; }).join("") +
            '</select>' +
          '</div>' +
          (list.length
            ? '<div class="pax-list-head"><span>Passenger</span><span>ID</span><span>Phone</span><span>Trip</span><span>Payment</span><span>Status</span><span></span></div>' +
              '<div class="pax-list">' + list.map(row).join("") + '</div>'
            : emptyBlock())) +
      '</section><aside class="pax-side">' +
        '<section><h2>Boarding progress</h2><p class="note">Seats filled on ' + esc(dayF === todayIso() ? "today’s" : dayF + "’s") + ' sailings' + (tripF ? " (selected schedule)" : "") + '. Click a sailing to filter.</p>' + boardingBlock() + '</section>' +
        '<section><h2>Passenger tools</h2><p class="note">Manifests and pier tools.</p>' +
          '<div class="pax-tools">' +
            '<a class="pax-tool" href="operations.html"><span class="tic">' + icon(I.list) + '</span><span><strong>Trip manifests</strong><small>Open a trip in Operations → Passengers.</small></span></a>' +
            '<button type="button" id="toolVerify"><span class="tic">' + icon(I.shield) + '</span><span><strong>Boarding verification</strong><small>Check in and board from the trip detail.</small></span></button>' +
            '<button type="button" id="toolHist"><span class="tic">' + icon(I.hist) + '</span><span><strong>Refresh list</strong><small>Reload bookings and payments.</small></span></button>' +
          '</div>' +
        '</section>' +
      '</aside></div>';

    bind();
  }

  function openAdd() {
    var cats = ((company.settings || {})["7_passenger_categories"]) || ["Adult", "Child", "Infant", "Senior", "Student", "Resident", "Tourist"];
    if (!Array.isArray(cats)) cats = ["Adult", "Child"];
    cats = cats.map(function (r) { return typeof r === "string" ? r : r && r.name; }).filter(Boolean);
    openModal('<h2>Add passenger</h2><p class="note">Saves to the passenger registry. To put them on a sailing, book from Operations → trip → Passengers.</p>' +
      '<div class="cards">' +
        '<div class="fld"><label for="pName">Full name</label><input id="pName" maxlength="120" placeholder="e.g. Ali Hassan"></div>' +
        '<div class="fld"><label for="pDoc">Document / ID</label><input id="pDoc" maxlength="40" placeholder="e.g. A1234567"></div>' +
        '<div class="fld"><label for="pPhone">Phone</label><input id="pPhone" maxlength="30" placeholder="+960 …"></div>' +
        '<div class="fld"><label for="pCat">Category</label><select id="pCat">' + cats.map(function (c) { return '<option>' + esc(c) + '</option>'; }).join("") + '</select></div>' +
        '<div class="fld full"><label for="pEmail">Email (optional)</label><input id="pEmail" type="email" maxlength="120"></div>' +
      '</div>' +
      '<p class="msg" id="mMsg" role="status"></p>' +
      '<div class="modal-actions"><button type="button" class="ghost" data-close>Cancel</button><button type="button" class="save" id="pGo">Save passenger</button></div>');
    $("pGo").addEventListener("click", function () {
      var name = $("pName").value.trim();
      if (!name) { say("Enter a full name.", "err"); return; }
      say("Saving…");
      db.from("passengers").insert({
        company_id: company.id,
        full_name: name,
        id_number: $("pDoc").value.trim() || null,
        phone: $("pPhone").value.trim() || null,
        email: $("pEmail").value.trim() || null,
        category: $("pCat").value || "Adult"
      }).select().single().then(function (r) {
        if (r.error) { say(r.error.message, "err"); return; }
        closeModal();
        reload();
      });
    });
  }

  function say(t, k) { var m = $("mMsg"); if (m) { m.textContent = t; m.className = "msg " + (k || ""); } }
  function openModal(html) {
    $("modalCard").className = "modal-card pax-modal";
    $("modalCard").innerHTML = html;
    $("modal").hidden = false;
    var f = $("modalCard").querySelector("input,select,textarea");
    if (f) f.focus();
  }
  function closeModal() { $("modal").hidden = true; $("modalCard").innerHTML = ""; }

  function bind() {
    [].forEach.call(document.querySelectorAll("[data-tab]"), function (b) {
      b.addEventListener("click", function () { tab = b.dataset.tab; render(); });
    });
    if ($("paxDay")) $("paxDay").addEventListener("change", function () {
      dayF = $("paxDay").value || todayIso();
      tripF = "";
      schedOpen = false;
      reload();
    });
    if ($("paxTripBtn")) $("paxTripBtn").addEventListener("click", function (e) {
      e.stopPropagation();
      schedOpen = !schedOpen;
      var wrap = $("paxSched"), panel = $("paxTripPanel"), btn = $("paxTripBtn");
      if (wrap) wrap.classList.toggle("open", schedOpen);
      if (btn) btn.setAttribute("aria-expanded", schedOpen ? "true" : "false");
      if (panel) panel.hidden = !schedOpen;
    });
    [].forEach.call(document.querySelectorAll("[data-sched]"), function (b) {
      b.addEventListener("click", function (e) {
        e.stopPropagation();
        tripF = b.getAttribute("data-sched") || "";
        schedOpen = false;
        render();
      });
    });
    [].forEach.call(document.querySelectorAll("[data-pick-trip]"), function (b) {
      b.addEventListener("click", function () {
        var id = b.dataset.pickTrip;
        tripF = tripF === id ? "" : id;
        schedOpen = false;
        render();
      });
    });
    if ($("paxStatus")) $("paxStatus").addEventListener("change", function () { statusF = $("paxStatus").value; render(); });
    if ($("paxPay")) $("paxPay").addEventListener("change", function () { payF = $("paxPay").value; render(); });
    if ($("paxQ")) $("paxQ").addEventListener("input", function () {
      q = $("paxQ").value.trim(); render();
      var i = $("paxQ"); i.focus(); i.setSelectionRange(i.value.length, i.value.length);
    });
    if ($("paxNew")) $("paxNew").addEventListener("click", openAdd);
    if ($("emptyNew")) $("emptyNew").addEventListener("click", openAdd);
    if ($("toolVerify")) $("toolVerify").addEventListener("click", function () { location.href = "operations.html"; });
    if ($("toolHist")) $("toolHist").addEventListener("click", function () { reload(); });
  }

  function reload(opts) {
    opts = opts || {};
    // Soft refresh: keep the UI up while day data loads (no blank canvas).
    if (!opts.blank && $("pax") && $("pax").children.length) {
      $("pax").classList.add("pax-busy");
    } else {
      $("pax").innerHTML = '<p class="msg">Loading…</p>';
    }
    return load().then(function () {
      $("pax").classList.remove("pax-busy");
      render();
    }, function (err) {
      $("pax").classList.remove("pax-busy");
      $("pax").innerHTML = '<section class="dash-card"><h2>Could not load Passengers</h2><p class="note">' + esc(err.message) + '</p></section>';
    });
  }

  $("modal").addEventListener("click", function (e) { if (e.target === $("modal") || e.target.closest("[data-close]")) closeModal(); });
  document.addEventListener("keydown", function (e) {
    if (e.key !== "Escape") return;
    if (!$("modal").hidden) { closeModal(); return; }
    if (schedOpen) {
      schedOpen = false;
      if ($("paxSched")) $("paxSched").classList.remove("open");
      if ($("paxTripBtn")) $("paxTripBtn").setAttribute("aria-expanded", "false");
      if ($("paxTripPanel")) $("paxTripPanel").hidden = true;
    }
  });
  document.addEventListener("click", function (e) {
    if (!schedOpen) return;
    var wrap = $("paxSched");
    if (wrap && wrap.contains(e.target)) return;
    schedOpen = false;
    if (wrap) wrap.classList.remove("open");
    if ($("paxTripBtn")) $("paxTripBtn").setAttribute("aria-expanded", "false");
    if ($("paxTripPanel")) $("paxTripPanel").hidden = true;
  });

  window.addEventListener("hashchange", function () { if (company) render(); });

  window.VeyoraShell.start({
    active: "Passengers",
    onCompany: function (c, info) {
      company = c;
      canEdit = !!(info.canAll || info.canOps || info.isPlatform || info.isAdmin || info.myRole === "operations");
      canSet = !!info.isAdmin;
      return reload().then(function () {
        if (window.VeyoraTip) window.VeyoraTip("pax2", [
          "Pick a **Day** and **Schedule** to see who is on that sailing.",
          "Add walk-up bookings from **Operations → trip → Passengers → Add new passenger**.",
          "Filter further by boarding status or payment (Paid / Unpaid / Partly paid)."
        ]);
      });
    },
    onNone: function () { $("pax").innerHTML = '<section class="dash-card"><h2>No company yet</h2><p class="note">Ask your administrator for an invite.</p></section>'; },
    onError: function (err) { $("pax").innerHTML = '<section class="dash-card"><h2>Could not load Passengers</h2><p class="note">' + esc(err.message) + '</p></section>'; }
  });
})();
