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
  var dayF = null;   // YYYY-MM-DD, default today; "all" = all time (latest 120 sailings, latest 500 passengers)
  var tripF = "";    // trip id or ""
  var passengers = [];
  var trips = [];    // sailings on dayF
  var boarding = [];
  var schedOpen = false;
  var openKey = "";
  var openSnap = null;
  var personCache = {};
  var lookupSeq = 0;

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
    ship: '<path d="M3 17l2-7 7-3 7 3 2 7H3Z"/><path d="M5 17c1.2 1.5 3.2 2.5 7 2.5s5.8-1 7-2.5"/><path d="M12 7V4"/>',
    phone: '<path d="M6 3h4l2 5-2.4 1.4a12 12 0 0 0 5 5L16 12l5 2v4a2 2 0 0 1-2 2A16 16 0 0 1 4 6a2 2 0 0 1 2-3z"/>',
    id: '<rect x="3" y="5" width="18" height="14" rx="2"/><circle cx="9" cy="12" r="2"/><path d="M14 10h4M14 14h3"/>',
    pin: '<path d="M12 21s7-6.2 7-11a7 7 0 1 0-14 0c0 4.8 7 11 7 11z"/><circle cx="12" cy="10" r="2.2"/>'
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

  function shortDay(ts) { return new Date(ts).toLocaleDateString("en-GB", { day: "numeric", month: "short" }); }
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
      tripId: r.trip_id,
      seat: r.seat_no || "",
      total: Number(b.fare_total) || 0, paid: Number(b.paid_amount) || 0,
      contactName: b.contact_name || "",
      from: (t.routes || {}).origin || "", to: (t.routes || {}).destination || "",
      departAt: t.depart_at || "", vessel: ((t.vessels || {}).name || (t.vessels || {}).code || "")
    };
  }

  function load() {
    if (!dayF) dayF = todayIso();
    var all = dayF === "all", day = all ? "" : dayF, next = all ? "" : addDays(day, 1);
    var tq = db.from("trips")
      .select("id, code, kind, depart_at, seats_booked, seats_total, status, routes(name, origin, destination)")
      .eq("company_id", company.id);
    tq = all ? tq.gt("seats_booked", 0).order("depart_at", { ascending: false }).limit(200)
             : tq.gte("depart_at", day + "T00:00:00").lt("depart_at", next + "T00:00:00").order("depart_at");
    return tq
      .then(function (res) {
        if (res.error) throw new Error(res.error.message);
        trips = (res.data || []).filter(function (t) { return t.status !== "Cancelled"; });
        if (tripF && !trips.some(function (t) { return t.id === tripF; })) tripF = "";
        boarding = trips.map(function (t) {
          return {
            id: t.id,
            route: routeLabel(t),
            time: (dayF === "all" ? shortDay(t.depart_at) + " " : "") + fmtTime(t.depart_at),
            booked: t.seats_booked || 0,
            capacity: t.seats_total != null ? t.seats_total : 0
          };
        });
        // Always load the whole day; schedule filter is client-side (instant).
        var ids = trips.map(function (t) { return t.id; });
        if (!ids.length) { passengers = []; return; }
        return db.from("booking_passengers")
          .select("id, full_name, category, id_number, phone, seat_no, status, trip_id, booking_id, fare, created_at, bookings(reference, payment_status, status, contact_name, contact_phone, paid_amount, fare_total), trips(code, depart_at, seats_booked, seats_total, status, routes(name, origin, destination), vessels(name, code))")
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
    var dayLabel = dayF === "all" ? "all time" : dayF === todayIso() ? "today" : dayF;
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

  var AV = ["#6d28d9", "#2563eb", "#0d9488", "#db2777", "#d97706", "#4f46e5", "#0891b2", "#059669"];
  function initialsOf(name) {
    return (name || "?").split(/\s+/).filter(Boolean).map(function (w) { return w[0]; }).join("").slice(0, 2).toUpperCase() || "?";
  }
  function avatarColor(name) {
    var s = 0, i, n = String(name || "");
    for (i = 0; i < n.length; i++) s = (s + n.charCodeAt(i)) % AV.length;
    return AV[s];
  }
  function letterOf(name) {
    var ch = (String(name || "").trim()[0] || "#").toUpperCase();
    return /[A-Z]/.test(ch) ? ch : "#";
  }
  function telHref(phone) {
    var d = String(phone || "").replace(/[^\d+]/g, "");
    return d.length >= 6 ? "tel:" + d : "";
  }
  function phoneKey(phone) {
    var d = String(phone || "").replace(/\D/g, "");
    if (d.indexOf("960") === 0 && d.length > 7) d = d.slice(3);
    return d.length >= 6 ? d : "";
  }
  function personGroups(list) {
    var map = {}, order = [];
    list.forEach(function (p) {
      var key = phoneKey(p.phone) || ("row:" + p.id);
      if (!map[key]) {
        map[key] = { key: key, rows: [] };
        order.push(map[key]);
      }
      map[key].rows.push(p);
    });
    order.forEach(function (g) {
      g.rows.sort(function (a, b) { return String(b.departAt || "").localeCompare(String(a.departAt || "")); });
      var latest = g.rows[0] || {};
      g.name = latest.name || "Passenger";
      g.phone = latest.phone || "";
      g.category = latest.category || "Adult";
      g.status = latest.status || "Booked";
      g.payment = latest.payment || "Unpaid";
      g.document = "";
      g.rows.forEach(function (r) { if (!g.document && r.document) g.document = r.document; });
      g.latest = latest;
    });
    return order;
  }
  function groupByKey(key) {
    var groups = personGroups(passengers), i;
    for (i = 0; i < groups.length; i++) if (groups[i].key === key) return groups[i];
    return openSnap && openSnap.key === key ? openSnap : null;
  }
  function rowsToTrips(rows) {
    return (rows || []).map(function (p) {
      return {
        trip_id: p.tripId, depart_at: p.departAt, origin: p.from, destination: p.to,
        passenger_status: p.status, booking_status: p.bookingStatus, reference: p.ticket, vessel: p.vessel,
        code: p.nextTime
      };
    });
  }
  function fmtTripWhen(ts) {
    if (!ts) return "";
    var d = new Date(ts);
    if (isNaN(d.getTime())) return "";
    return d.toLocaleDateString("en-GB", { weekday: "short", day: "numeric", month: "short", year: "numeric" }) + " · " + fmtTime(ts);
  }
  function contactCard(g, i) {
    var name = g.name || "Passenger";
    var tel = telHref(g.phone);
    var latest = g.latest || {};
    var n = g.rows.length;
    var gone = g.status === "Cancelled" || g.status === "No-show";
    var phone = g.phone
      ? (tel ? '<a href="' + esc(tel) + '">' + esc(g.phone) + '</a>' : esc(g.phone))
      : '<span class="muted">No phone</span>';
    var call = tel
      ? '<a class="call" href="' + esc(tel) + '">' + icon(I.phone) + ' Call</a>'
      : '<span class="call off">' + icon(I.phone) + ' Call</span>';
    var sub = n > 1
      ? (n + " trips" + (latest.nextTime ? " · latest " + latest.nextTime : ""))
      : [latest.nextTime, latest.ticket].filter(Boolean).join(" · ");
    return '<article class="pax-contact st-' + slug(g.status || "Booked") + (gone ? " off" : "") + '" data-person="' + esc(g.key) + '" role="button" tabindex="0" style="--av:' + avatarColor(name) + ';--i:' + Math.min(i, 14) + '">' +
      '<header><span class="av" aria-hidden="true">' + esc(initialsOf(name)) + '</span>' +
        '<div class="who"><strong>' + esc(name) + '</strong><small>' + esc(g.category || "Adult") + (n > 1 ? " · " + n + " trips" : "") + '</small></div>' +
        '<div class="badges">' + chip(g.status || "Booked") + payChip(g.payment) + (n > 1 ? '<span class="chip st-trips">' + n + ' trips</span>' : "") + '</div></header>' +
      '<ul class="facts">' +
        '<li>' + icon(I.phone) + phone + '</li>' +
        '<li>' + icon(I.id) + (g.document ? esc(g.document) : '<span class="muted">No ID</span>') + '</li>' +
        '<li>' + icon(I.pin) + '<span><strong>' + esc(latest.nextTrip || "No trip") + '</strong>' +
          (sub ? '<small>' + esc(sub) + '</small>' : "") + '</span></li>' +
      '</ul>' +
      '<footer>' + call + '<button type="button" class="open">Details</button></footer></article>';
  }
  function directoryHtml(list) {
    var groups = {}, order = [], n = 0;
    personGroups(list).sort(function (a, b) {
      return String(a.name || "").localeCompare(String(b.name || ""), undefined, { sensitivity: "base" });
    }).forEach(function (p) {
      var ch = letterOf(p.name);
      if (!groups[ch]) { groups[ch] = []; order.push(ch); }
      groups[ch].push(p);
    });
    order.sort(function (a, b) {
      if (a === "#") return 1;
      if (b === "#") return -1;
      return a < b ? -1 : a > b ? 1 : 0;
    });
    var nav = order.map(function (ch) {
      var key = ch === "#" ? "num" : ch;
      return '<button type="button" data-jump="' + key + '">' + esc(ch) + '</button>';
    }).join("");
    var body = order.map(function (ch) {
      var key = ch === "#" ? "num" : ch;
      var cards = groups[ch].map(function (p) { return contactCard(p, n++); }).join("");
      return '<section class="pax-letter" id="paxL-' + key + '"><h3>' + esc(ch) + '<b>' + groups[ch].length + '</b></h3><div class="pax-contacts">' + cards + '</div></section>';
    }).join("");
    return '<div class="pax-dir"><nav class="pax-alpha" aria-label="Jump to a letter">' + nav + '</nav><div class="pax-dir-body">' + body + '</div></div>';
  }
  function tripLine(x) {
    var route = [x.origin, x.destination].filter(Boolean).join(" → ") || x.code || "Trip";
    var when = fmtTripWhen(x.depart_at);
    var meta = [when, x.vessel, x.reference].filter(Boolean).join(" · ");
    var st = x.passenger_status || x.booking_status || "Booked";
    return '<li class="st-' + slug(st) + '"><span><strong>' + esc(route) + '</strong><small>' + esc(meta || "Trip") + '</small></span>' + chip(st) + '</li>';
  }
  function personHtml(key) {
    var g = groupByKey(key);
    var saved = personCache[key] || {};
    var profile = saved.profile || {};
    var name = profile.full_name || (g && g.name) || "Passenger";
    var phone = profile.phone || (g && g.phone) || "";
    var trips = saved.trips || (g ? rowsToTrips(g.rows) : []);
    var tel = telHref(phone);
    function line(label, value) {
      if (value == null || value === "") return "";
      return '<div><small>' + esc(label) + '</small><strong>' + esc(value) + '</strong></div>';
    }
    var facts = line("Phone", phone) + line("ID", profile.id_number || (g && g.document)) +
      line("Category", profile.category || (g && g.category)) + line("Email", profile.email) +
      line("Nationality", profile.nationality) + line("Date of birth", profile.dob ? String(profile.dob).slice(0, 10) : "") +
      line("Emergency contact", profile.emergency_contact);
    return '<div class="pax-person">' +
      '<button type="button" class="pax-person-back" id="paxPersonBack">' + icon(I.chev) + ' Passengers</button>' +
      '<section class="pax-person-hero">' +
        '<span class="av" style="--av:' + avatarColor(name) + '">' + esc(initialsOf(name)) + '</span>' +
        '<div><p class="kicker">' + trips.length + ' trip' + (trips.length === 1 ? "" : "s") + '</p><h2>' + esc(name) + '</h2>' +
          '<p>' + esc([profile.category || (g && g.category) || "Adult", phone || "No phone"].join(" · ")) + '</p></div>' +
        (tel ? '<a class="call" href="' + esc(tel) + '">' + icon(I.phone) + ' Call</a>' : "") +
      '</section>' +
      (facts ? '<section class="pax-person-facts">' + facts + '</section>' : "") +
      (profile.note ? '<p class="pax-person-note">' + esc(profile.note) + '</p>' : "") +
      '<section class="pax-person-hist"><h3>Travel history</h3>' +
        (saved.loading ? '<p class="note">Checking earlier trips…</p>' : "") +
        (saved.err ? '<p class="note">Earlier trips could not be loaded. Showing the trips on this list.</p>' : "") +
        (trips.length
          ? '<ol>' + trips.map(tripLine).join("") + '</ol>'
          : '<p class="note">No trips for this passenger yet.</p>') +
      '</section></div>';
  }
  function openPerson(key) {
    var g = groupByKey(key);
    if (!g) return;
    openKey = key;
    openSnap = g;
    var seq = ++lookupSeq;
    var local = rowsToTrips(g.rows);
    if (!phoneKey(g.phone)) {
      personCache[key] = { loading: false, trips: local, profile: null };
      render();
      return;
    }
    personCache[key] = { loading: true, trips: local, profile: personCache[key] && personCache[key].profile };
    render();
    rpc("lookup_passenger_phone", { p_company: company.id, p_phone: g.phone }).then(function (d) {
      if (openKey !== key || seq !== lookupSeq) return;
      var remote = d && d.trips && d.trips.length ? d.trips : local;
      personCache[key] = { loading: false, found: !!(d && d.found), trips: remote, profile: d && d.found ? d : null };
      render();
    }, function () {
      if (openKey !== key || seq !== lookupSeq) return;
      personCache[key] = { loading: false, err: true, trips: local, profile: null };
      render();
    });
  }
  function heroHtml(k, pool, peopleCount) {
    var lines = pool.length, total = peopleCount != null ? peopleCount : lines, checked = pool.filter(function (p) { return p.status === "Checked in" || p.status === "Boarded"; }).length;
    var boarded = pool.filter(function (p) { return p.status === "Boarded"; }).length;
    var unpaid = pool.filter(function (p) { return p.payment === "Unpaid" || p.payment === "Partly paid"; }).length;
    var pctC = lines ? Math.round(checked * 100 / lines) : 0, pctB = lines ? Math.round(boarded * 100 / lines) : 0;
    var allTime = dayF === "all", day = allTime ? todayIso() : (dayF || todayIso()), d = new Date(day + "T00:00:00");
    function stat(cls, ic, n, label) { return '<div class="pax2-stat ' + cls + '"><span class="ic">' + icon(ic) + '</span><strong>' + fmtNum(n) + '</strong><small>' + label + '</small></div>'; }
    return '<section class="pax2-hero"><div class="pax2-hero-l"><small>' + esc(d.toLocaleDateString("en-GB", { weekday: "long", day: "numeric", month: "long" })) + (day === todayIso() ? ' · <b>Today</b>' : "") + '</small>' +
      '<h2><span>' + fmtNum(total) + '</span> passenger' + (total === 1 ? "" : "s") + (tripF ? " on this sailing" : "") + '</h2>' +
      '<div class="pax2-funnel" aria-label="Boarding progress"><div class="trk"><i class="c" style="width:' + pctC + '%"></i><i class="b" style="width:' + pctB + '%"></i></div>' +
        '<div class="lg"><span><i class="c"></i>' + checked + ' checked in (' + pctC + '%)</span><span><i class="b"></i>' + boarded + ' boarded</span><span><i></i>' + k.awaiting + ' still to check in</span></div></div></div>' +
      '<div class="pax2-stats">' + stat("a", I.ticket, k.confirmed, "Active bookings") + stat("b", I.check, k.checked, "Checked in") + stat("c", I.clock, k.awaiting, "Awaiting") + stat("d", I.shield, unpaid, "Unpaid / part-paid") + '</div></section>';
  }
  function railHtml() {
    if (!boarding.length) return '<div class="pax2-rail-empty">No sailings on this day.</div>';
    return '<div class="pax2-rail">' + boarding.map(function (b) {
      var pct = b.capacity ? Math.min(100, Math.round((b.booked / b.capacity) * 100)) : 0, on = tripF === b.id;
      var cls = pct >= 90 ? "hot" : pct >= 70 ? "warm" : "";
      return '<button type="button" class="pax2-sail ' + cls + (on ? " on" : "") + '" data-pick-trip="' + esc(b.id) + '"><strong>' + esc(b.time || "—") + '</strong><span>' + esc(b.route) + '</span>' +
        '<em>' + b.booked + ' / ' + (b.capacity || "—") + '</em><i style="width:' + pct + '%"></i></button>';
    }).join("") + '</div>';
  }
  function qChips(pool) {
    var cnt = {}; pool.forEach(function (p) { cnt[p.status] = (cnt[p.status] || 0) + 1; });
    return '<div class="pax2-qs">' + [["", "All", pool.length]].concat(["Booked", "Checked in", "Boarded", "No-show", "Cancelled"].map(function (x) { return [x, x, cnt[x] || 0]; })).map(function (c) {
      return '<button type="button" class="' + (statusF === c[0] ? "on" : "") + '" data-qstat="' + esc(c[0]) + '">' + esc(c[1]) + ' <b>' + c[2] + '</b></button>';
    }).join("") + '</div>';
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
        sub: trips.length ? trips.length + " sailing" + (trips.length === 1 ? "" : "s") + (dayF === "all" ? " (latest)" : " today") : "Pick another day",
        all: true
      };
    }
    var t = trips.filter(function (x) { return x.id === tripF; })[0];
    if (!t) {
      return { time: "—", title: "Schedule", sub: "Not on this day", all: true };
    }
    var s = seatsMeta(t);
    return {
      time: (dayF === "all" ? shortDay(t.depart_at) + " " : "") + (fmtTime(t.depart_at) || "—"),
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
        '<span class="pax-sd-time">' + esc((dayF === "all" ? shortDay(t.depart_at) + " " : "") + (fmtTime(t.depart_at) || "—")) + '</span>' +
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

    if (openKey) {
      $("pax").innerHTML = personHtml(openKey);
      bind();
      return;
    }
    var pool = passengers.filter(function (p) { return !tripF || p.tripId === tripF; });
    var alive = pool.filter(function (p) { return p.status !== "Cancelled"; });
    $("pax").innerHTML =
      '<div class="pax2">' + heroHtml(k, alive, personGroups(alive).length) +
      '<section class="pax2-sails"><header><h3>Sailings</h3><p>Pick one to see only its passengers.</p>' +
        (tripF ? '<button type="button" class="pax2-clear" data-pick-trip="">Show all</button>' : "") + '</header>' + railHtml() + '</section>' +
      '<section class="pax2-main">' +
        '<div class="pax2-toolrow"><div class="pax2-seg" role="tablist">' +
          [["all", "All passengers"], ["bookings", "Bookings"], ["checkin", "Check-in"], ["manifests", "Trip manifests"]].map(function (t) {
            return '<button type="button" role="tab" class="' + (tab === t[0] ? "on" : "") + '" data-tab="' + t[0] + '">' + t[1] + '</button>';
          }).join("") + '</div>' +
          '<div class="pax2-tools"><button type="button" id="toolVerify">' + icon(I.shield) + ' Boarding verification</button><button type="button" id="toolHist">' + icon(I.hist) + ' Refresh</button></div></div>' +
        (tab === "manifests" ? emptyBlock() :
          '<div class="pax-filters pax2-filters">' +
            '<label class="pax-day' + (dayF === "all" ? " is-all" : "") + '" title="Sailing day"><span>Day</span><input type="date" id="paxDay" value="' + esc(dayF === "all" ? todayIso() : (dayF || todayIso())) + '" aria-label="Sailing day"></label>' +
            '<button type="button" class="pax2-all' + (dayF === "all" ? " on" : "") + '" id="paxAll" aria-pressed="' + (dayF === "all") + '">' + icon(I.hist) + ' All time</button>' +
            schedulePickerHtml() +
            '<label class="fsearch">' + icon(I.search) + '<input type="search" id="paxQ" placeholder="Search name, ticket or ID" value="' + esc(q) + '" aria-label="Search passengers"></label>' +
            '<select id="paxPay" aria-label="Payment status"><option value="">All payments</option>' +
              pays.map(function (s) { return '<option value="' + esc(s) + '"' + (payF === s ? " selected" : "") + '>' + esc(s) + '</option>'; }).join("") +
            '</select>' +
          '</div>' + qChips(pool) +
          (list.length ? directoryHtml(list) : emptyBlock())) +
      '</section></div>';

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
        '<div class="fld"><label for="pPhone">Phone</label><input id="pPhone" maxlength="30" placeholder="+960 …"><small class="apx-known" id="pKnown" hidden></small></div>' +
        '<div class="fld"><label for="pCat">Category</label><select id="pCat">' + cats.map(function (c) { return '<option>' + esc(c) + '</option>'; }).join("") + '</select></div>' +
        '<div class="fld full"><label for="pEmail">Email (optional)</label><input id="pEmail" type="email" maxlength="120"></div>' +
      '</div>' +
      '<p class="msg" id="mMsg" role="status"></p>' +
      '<div class="modal-actions"><button type="button" class="ghost" data-close>Cancel</button><button type="button" class="save" id="pGo">Save passenger</button></div>');
    var looked = "", filled = false, onFile = false, timer = null;
    $("pGo").addEventListener("click", function () {
      var name = $("pName").value.trim();
      if (!name) { say("Enter a full name.", "err"); return; }
      if (onFile) { say("This passenger is already saved.", "ok"); return; }
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
    $("pPhone").addEventListener("input", function () {
      var raw = this.value, digits = String(raw).replace(/\D/g, ""), note = $("pKnown");
      clearTimeout(timer);
      if (digits.length < 6) { if (note) note.hidden = true; looked = ""; onFile = false; return; }
      timer = setTimeout(function () {
        if (digits === looked) return;
        looked = digits;
        rpc("lookup_passenger_phone", { p_company: company.id, p_phone: raw }).then(function (d) {
          if (String($("pPhone").value || "").replace(/\D/g, "") !== digits) return;
          if (!d || !d.found) {
            onFile = false;
            if (filled) { $("pName").value = ""; $("pDoc").value = ""; $("pEmail").value = ""; filled = false; }
            if (note) { note.hidden = false; note.textContent = "New number. Fill in the rest."; note.className = "apx-known is-new"; }
            return;
          }
          onFile = !!d.passenger_id;
          if (!$("pName").value || filled) { $("pName").value = d.full_name || ""; filled = true; }
          if (!$("pDoc").value || filled) $("pDoc").value = d.id_number || "";
          if (!$("pEmail").value || filled) $("pEmail").value = d.email || "";
          if (d.category && $("pCat")) $("pCat").value = d.category;
          var n = (d.trips || []).length;
          if (note) { note.hidden = false; note.textContent = "Saved passenger · " + (d.full_name || "") + (n ? " · " + n + " earlier trip" + (n === 1 ? "" : "s") : ""); note.className = "apx-known"; }
        }, function () {});
      }, 450);
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
    if ($("paxAll")) $("paxAll").addEventListener("click", function () {
      dayF = dayF === "all" ? todayIso() : "all";
      tripF = "";
      schedOpen = false;
      reload();
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
    [].forEach.call(document.querySelectorAll("[data-qstat]"), function (b) {
      b.addEventListener("click", function () { statusF = b.dataset.qstat; render(); });
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
    [].forEach.call(document.querySelectorAll("[data-jump]"), function (b) {
      b.addEventListener("click", function () {
        var el = document.getElementById("paxL-" + b.dataset.jump);
        if (el) el.scrollIntoView({ behavior: "smooth", block: "start" });
      });
    });
    [].forEach.call(document.querySelectorAll("[data-person]"), function (el) {
      el.addEventListener("click", function (e) {
        if (e.target.closest("a")) return;
        openPerson(el.getAttribute("data-person"));
      });
      el.addEventListener("keydown", function (e) {
        if (e.key !== "Enter" && e.key !== " ") return;
        e.preventDefault();
        openPerson(el.getAttribute("data-person"));
      });
    });
    if ($("paxPersonBack")) $("paxPersonBack").addEventListener("click", function () {
      openKey = "";
      render();
    });
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
    if (openKey) { openKey = ""; render(); return; }
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
