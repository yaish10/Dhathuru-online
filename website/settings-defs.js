/* Editor definition for every settings item, keyed by item title.
   Types: list, form, matrix, company, logo, users, status, info, audit, sessions, export, import.
   Values are stored per company (companies.settings) and every change is audited. */
(function () {
  var L = function (def, note) { return { type: "list", def: def, note: note }; };
  var F = function (note) { return { type: "form", note: note, fields: [].slice.call(arguments, 1) }; };
  var t = function (k, l, d, ph) { return { k: k, l: l, t: "text", d: d == null ? "" : d, ph: ph }; };
  var pw = function (k, l, ph) { return { k: k, l: l, t: "password", d: "", ph: ph || "" }; };
  var x = function (k, l, d) { return { k: k, l: l, t: "textarea", d: d || "" }; };
  var n = function (k, l, d, u) { return { k: k, l: l, t: "number", d: d, u: u }; };
  var s = function (k, l, o, d) { return { k: k, l: l, t: "select", o: o, d: d == null ? o[0] : d }; };
  var b = function (k, l, d) { return { k: k, l: l, t: "toggle", d: !!d }; };
  var tm = function (k, l, d) { return { k: k, l: l, t: "time", d: d }; };
  var M = function (note, rows, cols, def) { return { type: "matrix", note: note, rows: rows, cols: cols, def: def || function () { return false; } }; };
  var C = function (note) { return { type: "company", note: note, cols: [].slice.call(arguments, 1) }; };
  var I = function (text) { return { type: "info", text: text }; };
  var T = function (note, cols, def, rowLabel) { return { type: "table", note: note, cols: cols, def: def, rowLabel: rowLabel }; };

  var ROLES = ["Admin", "Operations", "HR", "IT", "Staff"];
  var PAY_DAYS = [];
  for (var pd = 1; pd <= 28; pd++) PAY_DAYS.push(String(pd));
  var MODULES = ["Dashboard", "Operations", "Schedules", "Fleet", "Passengers", "HR & Crew", "IT", "Finance", "Maintenance", "Reports", "Settings"];
  var DEPTS = ["Operations", "Fleet", "Passenger Services", "HR", "IT", "Finance", "Maintenance"];
  var ACTIONS = ["View", "Create", "Edit", "Delete", "Approve", "Export"];
  var DAYS = ["Monday", "Tuesday", "Wednesday", "Thursday", "Friday", "Saturday", "Sunday"];
  var role = ["Admin", "Operations", "HR", "IT", "Staff"];
  var SEC = "Do not enter passwords or API keys here. Secrets belong in the server configuration.";

  function approval(what, defRole) {
    return F("Controls who must approve " + what + ".", b("enabled", "Approval required", true), s("approver", "Approver role", ["Owner", "Admin", "Operations", "HR"], defRole || "Admin"),
      b("comment", "Require a comment", false), n("sla", "Reminder after", 24, "hours"), b("self", "Allow requester to approve their own", false));
  }
  function notif(what, ch) {
    return F("Choose how " + what + " are delivered.", b("email", "Email", ch !== "push"), b("inapp", "In-app", true), b("push", "Push", ch === "push"), s("audience", "Recipients", ["Owner & admins", "Department managers", "All staff", "Affected staff only"], "Owner & admins"));
  }
  function fmt(prefix, label) {
    return F("Pattern for " + label + ". Example: " + prefix + "-2026-000123", t("prefix", "Prefix", prefix), s("sep", "Separator", ["-", "/", "none"], "-"), b("year", "Include year", true), n("digits", "Sequence digits", 6), n("start", "Next number", 1));
  }


  /* Ready-made crew rotations. The first few are the defaults for Roster Patterns; all of them show on the
     Duty Roster Templates tab under "More templates". Codes D/E/N are the default shifts; OFF, L and TRN are reserved. */
  var PATTERN_LIBRARY = [
    { name: "4 on, 2 off (days)", pattern: "D,D,D,D,OFF,OFF", note: "Standard ferry crew on day sailings" },
    { name: "5 on, 2 off (days)", pattern: "D,D,D,D,D,OFF,OFF", note: "Office-style week for shore and day crew" },
    { name: "Week on, week off", pattern: "D,D,D,D,D,D,D,OFF,OFF,OFF,OFF,OFF,OFF,OFF", note: "Island-based crew who travel home between rotations" },
    { name: "14 on, 7 off", pattern: "D,D,D,D,D,D,D,D,D,D,D,D,D,D,OFF,OFF,OFF,OFF,OFF,OFF,OFF", note: "Long rotations for live-aboard or resort-island crew" },
    { name: "2-2-3 (days)", pattern: "D,D,OFF,OFF,D,D,D,OFF,OFF,D,D,OFF,OFF,OFF", note: "Every other weekend off over a two-week cycle" },
    { name: "Nights 4 on, 3 off", pattern: "N,N,N,N,OFF,OFF,OFF", note: "Night crossings and overnight watch" },
    { name: "Rotating D/E/N", pattern: "D,D,E,E,N,N,OFF,OFF", note: "Round-the-clock services shared fairly" },
    { name: "Early / late week", pattern: "D,D,D,E,E,E,OFF,OFF", note: "Mixing morning and evening sailings" },
    { name: "Evenings 5 on, 2 off", pattern: "E,E,E,E,E,OFF,OFF", note: "Late sailings and evening transfers" },
    { name: "3 on, 3 off (days)", pattern: "D,D,D,OFF,OFF,OFF", note: "Long-day crews with full rest between blocks" },
    { name: "2 on, 2 off (days)", pattern: "D,D,OFF,OFF", note: "Short rotations or part-time crew" },
    { name: "6 on, 1 off", pattern: "D,D,D,D,D,D,OFF", note: "Peak season with one rest day a week" },
    { name: "Weekend relief", pattern: "OFF,OFF,OFF,OFF,OFF,D,D", note: "Covering the weekend. Start it on the first weekend day" },
    { name: "Day / night swing", pattern: "D,D,D,OFF,N,N,N,OFF,OFF", note: "Crews covering both day and night routes" },
    { name: "Training week", pattern: "TRN,TRN,TRN,TRN,TRN,OFF,OFF", note: "A week of courses or drills" }
  ];
  window.VEYORA_PATTERN_LIBRARY = PATTERN_LIBRARY;
  var SHIFT_COLORS = ["Green", "Lime", "Teal", "Cyan", "Sky", "Blue", "Indigo", "Purple", "Violet", "Pink", "Rose", "Coral", "Orange", "Amber", "Gold", "Navy", "Slate", "Grey"];
  window.VEYORA_SHIFT_COLORS = SHIFT_COLORS;

  var D = {
    /* 1 Company */
    "Company Profile": C("Basic company details.", ["name", "Company name", "text"], ["type", "Company type", "select", ["Ferry Operator", "Speedboat Operator", "Both", "Other"]], ["region", "Operating region", "text"]),
    "Company Logo & Branding": { type: "logo" },
    "Company Registration Details": C("Official registration.", ["registration_no", "Registration number", "text"]),
    "Contact Information": C("How people reach the company.", ["email", "Official email", "email"], ["phone", "Contact number", "tel"]),
    "Office Address & Locations": C("Head office address.", ["address", "Office address", "textarea"]),
    "Company Status": { type: "status" },
    "Regional Settings": C("Region and language.", ["region", "Operating region", "text"], ["language", "Language", "select", ["English", "Dhivehi"]]),
    "Default Currency": C("Currency used across records.", ["currency", "Currency", "select", ["MVR", "USD", "EUR", "GBP", "LKR", "INR", "AED", "SGD"]]),
    "Timezone & Date Format": C("Dates and times shown in this format.", ["timezone", "Time zone", "select", ["Indian/Maldives", "Asia/Colombo", "Asia/Dubai", "Asia/Kolkata", "Asia/Singapore", "Europe/London", "UTC"]], ["date_format", "Date format", "select", ["DD MMM YYYY", "DD/MM/YYYY", "MM/DD/YYYY", "YYYY-MM-DD"]]),
    "Language Preferences": C("Default language.", ["language", "Language", "select", ["English", "Dhivehi"]]),

    /* 2 Users & access */
    "User Accounts": { type: "users" },
    "Invite Staff": { type: "users" },
    "Roles & Permissions": {
      type: "roles",
      note: "What each role may do. The owner always has full access. Add a role when the built-in ones do not fit.",
      builtin: ROLES,
      actions: ACTIONS,
      defaults: function (r, c) { return r === "Admin" || (c === "View") || (r === "Operations" && c !== "Delete" && c !== "Approve"); }
    },
    "Role Templates": L(["Operations Manager", "Dispatcher", "Crew Scheduler", "HR Officer", "Finance Officer", "Read-only Auditor"], "Reusable role presets for new staff."),
    "Department Access": Object.assign(M("Which departments each role can work in.", ROLES, DEPTS, function (r, c) { return r === "Admin" || (r === "Operations" && c === "Operations") || (r === "HR" && c === "HR"); }), { roles: true }),
    "Module Access": Object.assign(M("Which modules each role can open. Company-wide on/off is under IT Settings → Module & Feature Management.", ROLES, MODULES, function (r, c) { return r === "Admin" || (r === "Operations" && ["Dashboard", "Operations", "Schedules", "Fleet", "Passengers", "Maintenance", "Reports"].indexOf(c) > -1) || (r === "HR" && ["Dashboard", "HR & Crew", "Reports"].indexOf(c) > -1) || (r === "IT" && ["Dashboard", "IT", "Settings"].indexOf(c) > -1) || (r === "Staff" && c === "Dashboard"); }), { roles: true }),
    "Record-Level Access": F("How much of a record set each role sees.", s("admin", "Admin", ["All records", "Own department", "Own records only"], "All records"), s("operations", "Operations", ["All records", "Own department", "Own records only"], "Own department"), s("hr", "HR", ["All records", "Own department", "Own records only"], "Own department"), s("staff", "Staff", ["All records", "Own department", "Own records only"], "Own records only")),
    "Approval Permissions": Object.assign(M("Which roles may approve each request type.", ROLES, ["Trip cancellation", "Schedule change", "Crew assignment", "Leave", "Expense", "Payment", "Payroll", "Maintenance"], function (r) { return r === "Admin"; }), { roles: true }),
    "Account Activation & Suspension": { type: "users" },
    "Login History": I("Sign-in history for staff accounts will appear here once login auditing is enabled for the platform."),

    /* 3 Organization — Department Management / Job Titles moved to HR page; defs kept for seed defaults. */
    "Department Management": { type: "org-departments", base: L(DEPTS, "Departments in the company.") },
    "Job Titles & Positions": { type: "org-titles", base: L(["General Manager", "Operations Manager", "Dispatcher", "Captain", "First Mate", "Deckhand", "Engineer", "Ticketing Officer", "Accountant", "HR Officer"]) },
    "Organization Structure": { type: "org-chart", base: F("How the company is organised.", s("model", "Structure", ["Departmental", "Flat", "Regional"], "Departmental"), n("levels", "Management levels", 3), b("matrix", "Allow cross-department reporting", false)) },
    "Reporting Managers": { type: "org-managers", base: F("Reporting lines.", b("required", "Every employee must have a manager", true), s("fallback", "Default manager", ["Department head", "Operations Manager", "General Manager"], "Department head"), b("backup", "Allow an acting manager", true)) },
    /* Cursor 2026-10-24: Staff login IDs = HR prefix + 4 digits (e.g. vy-1000). */
    "Employee ID Format": {
      type: "org-ids",
      base: F(
        "Staff login IDs look like prefix-1000. Set the prefix here (e.g. vy). Numbers are always 4 digits.",
        t("prefix", "Staff ID prefix", "vy"),
        s("sep", "Separator", ["-"], "-"),
        b("year", "Include year", false),
        n("digits", "Sequence digits", 4),
        n("start", "First number", 1000)
      )
    },
    "Staff Categories": { type: "org-categories", base: L(["Management", "Operations", "Crew", "Shore staff", "Administration", "Contractor"]) },
    "Employment Types": { type: "org-employment", base: L(["Full-time", "Part-time", "Contract", "Seasonal", "Casual", "Intern"]) },

    /* 4 Operations */
    "Trip Statuses": L(["Scheduled", "Boarding", "Departed", "In transit", "Arrived", "Delayed", "Cancelled", "Completed"]),
    "Trip Number Format": fmt("TR", "trip numbers"),
    "Dispatch Rules": F("Rules applied before a trip is dispatched.", b("crew", "Require full crew assigned", true), b("checklist", "Require safety checklist", true), b("weather", "Require weather check", true), n("lead", "Dispatch window before departure", 60, "minutes")),
    // Cursor 2026-10-27: platform WeatherAPI.com key lives in config.js; companies only toggle/show and set the country suffix.
    "Weather": F("Live conditions on the Operations overview from WeatherAPI.com. The API key is shared for every company. Wind follows Distance Units (knots by default).",
      b("enabled", "Show weather on Operations overview", true),
      t("suffix", "Location country", "Maldives", "Added to island names, e.g. Maafushi, Maldives")),
    // Cursor 2026-10-27: company can turn each Operations safety check off; all default on.
    "Operations Controls": F("Each switch is on by default. Turn one off if this company should skip that check. Busy / warnings can still show when a block is off.",
      b("vesselClash", "Vessel conflict detection — block the same boat on overlapping trips", true),
      b("maintLock", "Maintenance safety lock — block restricted or out-of-service vessels", true),
      b("crewAvail", "Crew availability — warn if overlapping, absent, or ineligible", true),
      b("capacity", "Passenger capacity — block bookings or vessel changes over seats", true),
      b("readiness", "Departure readiness checklist — vessel, crew, seats, safety, clearance", true),
      b("disruption", "Trip disruption — delay, replace vessel, cancel, and affected passengers", true),
      b("actualTimes", "Actual departure / arrival times — show real times next to the schedule", true),
      b("completeCheck", "Trip completion check — unresolved boarding, payment, or tasks", true),
      b("paxTransfer", "Passenger transfer — move people to a replacement trip", true),
      b("trackFresh", "Tracking freshness — show when the last GPS fix arrived", true),
      b("tasks", "Dispatch task list — outstanding tasks on each sailing", true),
      b("audit", "Notification and audit history — trip log of important changes", true)),
    "Departure & Arrival Rules": F("Trips move on by the clock every minute. At departure time a trip is marked Departed when it can sail. If it cannot (no vessel, out of service, stopping defect, no captain), it is held — Delayed is never set automatically; Ops marks Delay by hand with a reason.",
      b("autoBoarding", "Open boarding automatically", true), n("boarding", "Boarding opens before departure", 15, "minutes"),
      b("autoDepart", "Mark Departed at departure time", true), b("needCaptain", "Hold the trip if no captain is assigned", true), b("needClearance", "Hold the trip until it is cleared for dispatch", false),
      n("grace", "Departure grace period", 10, "minutes"),
      b("auto", "Mark Arrived at arrival time", true), n("arriveAfter", "Mark Arrived this long after the arrival time", 0, "minutes")),
    // Claude 2026-10-28: GPS harbour arrival detection (0058). Same editors as Operations → Arrival detection → Harbours, drawn by arrivals.js.
    "Harbour Autopilot": { type: "arrivals", tab: "auto" },
    "Arrival Detection": { type: "arrivals", tab: "settings" },
    "Harbours & Geofences": { type: "arrivals", tab: "harbours" },
    "Route Harbours": { type: "arrivals", tab: "routes" },
    "Auto Crew Rules": F("Fill empty captain and crew places on trips from the duty roster (people on a shift that covers the whole trip, not on leave, not on another trip; people assigned to the vessel first). People you choose by hand are never replaced.",
      b("enabled", "Assign crew from the roster automatically", true), n("hours", "Assign up to", 48, "hours before departure"),
      b("captain", "Assign a captain", true), n("deck", "Deck crew per trip", 1), n("engineering", "Engineering crew per trip", 1)),
    "Trip Cancellation Rules": F("Cancellation policy.", b("reason", "Reason required", true), b("approval", "Needs approval", true), n("notice", "Minimum notice to passengers", 2, "hours"), b("notify", "Notify passengers automatically", true)),
    "Delay Reasons": L(["Weather", "Technical fault", "Late crew", "Late passengers", "Port congestion", "Fuel delay", "Safety inspection", "Other"]),
    "Incident Categories": L(["Safety", "Passenger injury", "Vessel damage", "Near miss", "Security", "Environmental", "Medical", "Other"]),
    "Operational Approval Rules": F("When operations need approval.", b("lateDispatch", "Dispatch after the cut-off time", true), b("overCapacity", "Boarding above capacity", true), b("weather", "Sailing in adverse weather", true), s("approver", "Approver", ["Owner", "Admin", "Operations"], "Operations")),
    "Operations Check-in": F("Staff check in to Operations (on a vessel) in the mobile apps. Without it the apps are in look-up mode (read only). Checking in unlocks Mark paid, Board, Check in passenger, No-show and Cancel.", b("enabled", "Use Operations check-in (look-up mode until staff check in)", true), b("enforce", "Also enforce it in the database (the website then needs a check-in too)", false), n("hours", "A check-in that was never closed stops counting after", 16, "hours")),
    "Seating": F("Seat numbers on bookings and passengers. Off by default: the mobile apps then hide seat numbers and only count seats.", b("enabled", "Use seat numbers (assigned seating)", false)),
    "Passenger Capacity Rules": F("Capacity safeguards.", n("buffer", "Reserved safety buffer", 5, "%"), b("block", "Block boarding above capacity", true), n("crewSeats", "Seats reserved for crew", 0), b("standing", "Allow standing passengers", false)),
    "Operational Notifications": notif("operational alerts"),

    /* 5 Routes */
    "Island & Location Directory": L(["Malé", "Hulhumalé", "Maafushi", "Guraidhoo", "Thulusdhoo", "Dhiffushi", "Gulhi", "Himmafushi"]),
    "Atoll Management": L(["Kaafu", "Alif Alif", "Alif Dhaalu", "Vaavu", "Meemu", "Faafu", "Dhaalu", "Thaa", "Laamu", "Baa", "Raa", "Noonu", "Shaviyani", "Haa Dhaalu", "Haa Alif", "Gaafu Alif", "Gaafu Dhaalu", "Gnaviyani", "Addu"]),
    "Terminals & Jetties": L(["Malé Commercial Harbour", "Villingili Ferry Terminal", "Hulhumalé Ferry Terminal", "Maafushi Jetty"]),
    "Route Management Settings": F("How routes behave.", b("approval", "New routes need approval", false), b("returns", "Create return routes automatically", true), b("stops", "Allow intermediate stops", true), n("maxStops", "Maximum stops per route", 5)),
    "Route Naming Format": F("Pattern for route names.", s("pattern", "Pattern", ["Origin – Destination", "Origin → Destination", "Code (ORG-DST)"], "Origin – Destination"), b("code", "Add route code", true), t("prefix", "Route code prefix", "RT")),
    "Default Journey Durations": F("Planning defaults.", n("short", "Short route", 30, "minutes"), n("medium", "Medium route", 90, "minutes"), n("long", "Long route", 240, "minutes"), n("buffer", "Turnaround buffer", 15, "minutes")),
    "Distance Units": F("Units for distances and speed.", s("distance", "Distance", ["Nautical miles", "Kilometres", "Miles"], "Nautical miles"), s("speed", "Speed", ["Knots", "km/h"], "Knots")),
    "Boarding Locations": L(["Main jetty", "Passenger terminal", "Floating pontoon", "Beach landing"]),
    "Location Activation & Deactivation": L([], "Locations currently deactivated. Add a name to deactivate it; remove it to reactivate."),

    /* 6 Schedules */
    "Schedule Types": L(["Fixed", "Promotional", "Temporary", "Seasonal", "Charter"], "Kinds of timetable. Fixed = regular service; Promotional = offers/events; Temporary = short-run or one-off. Add more as needed."),
    "Schedule Templates": L(["Weekday standard", "Weekend standard", "Holiday reduced", "Peak season", "Ramadan"]),
    "Recurring Trip Rules": F("Generating trips from templates.", s("horizon", "Generate ahead", ["7 days", "14 days", "30 days", "90 days"], "30 days"), b("skipHolidays", "Skip public holidays", false), b("auto", "Publish automatically", true)),
    "Default Departure Intervals": F("Default frequency.", n("peak", "Peak interval", 30, "minutes"), n("offpeak", "Off-peak interval", 60, "minutes"), tm("first", "First departure", "06:00"), tm("last", "Last departure", "22:00")),
    "Operating Days": F("Days the company operates.", b("mon", "Monday", true), b("tue", "Tuesday", true), b("wed", "Wednesday", true), b("thu", "Thursday", true), b("fri", "Friday", true), b("sat", "Saturday", true), b("sun", "Sunday", true)),
    "Holiday Calendar": L([], "Add one per line as: 2026-12-25 Christmas. Dates in YYYY-MM-DD."),
    "Seasonal Schedules": L(["High season (Nov–Apr)", "Low season (May–Oct)", "Ramadan hours", "Eid holidays"]),
    "Schedule Change Approvals": approval("schedule changes", "Operations"),
    "Departure Cut-off Times": F("Latest times for changes and boarding.", n("booking", "Close booking before departure", 30, "minutes"), n("checkin", "Close check-in before departure", 15, "minutes"), n("change", "Lock schedule changes before departure", 60, "minutes")),
    "Schedule Conflict Rules": F("Crew overlap and rest. Vessel overlap is under Operations Settings → Operations Controls.",
      b("crew", "Prevent double-booking crew", true), b("rest", "Enforce crew rest between trips", true), n("minRest", "Minimum rest", 8, "hours")),

    /* 7 Fleet */
    "Vessel Categories": L(["Ferry", "Speedboat", "Cargo boat", "Dhoni", "Catamaran", "Work boat"]),
    "Vessel Type Definitions": L(["Passenger ferry", "High-speed craft", "Landing craft", "Utility vessel", "Rescue boat"]),
    "Vessel Registration Format": fmt("VSL", "vessel registration numbers"),
    "Vessel Statuses": L(["Active", "In service", "Docked", "Under maintenance", "Out of service", "Decommissioned"]),
    "Vessel Capacity Rules": F("Capacity limits.", n("pax", "Default passenger capacity", 100), n("crew", "Default minimum crew", 3), n("cargo", "Default cargo capacity", 5, "tonnes"), b("override", "Allow capacity override with approval", false)),
    "Engine Type Categories": L(["Inboard diesel", "Outboard petrol", "Outboard diesel", "Hybrid", "Electric"]),
    "Vessel Document Types": L(["Registration certificate", "Safety certificate", "Insurance", "Survey report", "Load line certificate", "Radio licence"]),
    "Vessel Availability Rules": F("When a vessel can be scheduled.", b("maintenance", "Block vessels under maintenance", true), b("expired", "Block vessels with expired documents", true), n("buffer", "Turnaround buffer", 20, "minutes")),
    "Vessel Assignment Restrictions": F("Assigning vessels to routes.", b("route", "Restrict vessels to approved routes", true), b("crew", "Require certified captain", true), b("night", "Restrict night operation", true)),
    "Vessel Tracking": F("Live vessel positions on the dashboard map. Off by default. No API keys are stored here: the tracking key is kept on the server.",
      b("enabled", "Show vessel tracking on the dashboard", false),
      s("provider", "Tracking provider", ["FollowMe"], "FollowMe"),
      Object.assign(n("refresh", "Refresh positions every", 1, "minutes (minimum 1)"), { min: 1, max: 60 }),
      Object.assign(n("stale", "Mark a vessel offline after no update for", 15, "minutes"), { min: 1, max: 1440 }),
      s("view", "Map view", ["Fit all vessels", "Maldives overview"], "Fit all vessels"),
      s("height", "Map size", ["Compact", "Standard", "Large"], "Standard"),
      b("labels", "Show vessel names on the map", false),
      b("docked", "Show docked vessels", true),
      b("maintenance", "Show vessels in maintenance", true)),

    /* 8 Passenger */
    "Booking Reference Format": fmt("BK", "booking references"),
    "Passenger Categories": L(["Adult", "Child", "Infant", "Senior", "Student", "Resident", "Tourist"]),
    "Ticket Types": L(["One-way", "Return", "Multi-trip", "Day pass", "Group", "Staff"]),
    "Booking Statuses": L(["Pending", "Confirmed", "Checked in", "Boarded", "Completed", "Cancelled", "No-show", "Refunded"]),
    "Check-in Rules": F("Check-in policy. At departure, checked-in passengers are marked Boarded automatically.", n("opens", "Check-in opens before departure", 60, "minutes"), n("closes", "Check-in closes before departure", 15, "minutes"), b("id", "Require ID at check-in", true), b("qr", "Allow QR check-in", true), b("autoNoShow", "Mark passengers not checked in as No-show at departure", false)),
    "Cancellation & Refund Rules": F("Refund policy.", n("full", "Full refund up to", 24, "hours before"), n("partial", "Partial refund up to", 6, "hours before"), n("partialPct", "Partial refund amount", 50, "%"), b("operator", "Full refund if the operator cancels", true)),
    "Passenger Manifest Settings": F("Manifest contents.", b("id", "Include ID number", true), b("nationality", "Include nationality", true), b("contact", "Include emergency contact", false), b("auto", "Generate automatically at departure", true)),
    "Booking Cut-off Times": F("Booking limits.", n("close", "Close bookings before departure", 30, "minutes"), n("advance", "Open bookings up to", 30, "days ahead"), b("walkup", "Allow walk-up bookings", true)),
    "Passenger Notifications": notif("passenger notifications"),
    "Required Passenger Information": F("Fields collected per passenger.", b("name", "Full name", true), b("id", "ID / passport number", true), b("phone", "Phone number", true), b("email", "Email", false), b("nationality", "Nationality", false), b("dob", "Date of birth", false), b("emergency", "Emergency contact", false)),

    /* 18 IT Settings. type "it": optional rules form (base), links to the IT pages that do the work, or a note when the platform runs it. */
    "Access Controls": { type: "it", note: "Who can open which part of VEYORA.", links: [["Roles & Permissions", "settings.html#open=Roles%20%26%20Permissions"], ["User accounts", "settings.html#open=User%20Accounts"], ["Who has access", "it.html#people"]] },
    "Network & IP Restrictions": { type: "it", note: "Your approved office and VPN networks (public IP or CIDR range).", links: [["Approved networks", "it.html#networks"]],
      base: F("Pages that only open on an approved network.", b("gate", "HR, admins and IT can only open HR & Crew, Payroll, Reports and IT pages on an approved network (staff keep their own pages)", false), b("bypass", "Owners and IT can always open them (prevents locking yourself out)", true)) },
    "Mobile Check-in & Check-out": { type: "it", note: "Rules for clocking in and out from the app. Grace periods and missed punches are in Duty & Attendance → Settings.", links: [["Attendance Rules", "hr.html#attendance/settings/rules"], ["Clock-in activity", "it.html#log"]],
      base: F("Clocking in from the app.", b("enabled", "Allow clocking in and out from the app", true), s("network", "Allowed from", ["Any network", "Approved networks only"], "Any network"),
        s("device", "Devices", ["Any device", "Registered devices only"], "Any device"), b("kiosk", "Allow shared kiosk devices (attendance terminals)", true),
        t("depts", "Only these departments (comma separated, empty = everyone)", "")) },
    "Device Management": { type: "it", note: "Phones, computers and attendance terminals that staff use.", links: [["Devices", "it.html#devices"]],
      base: F("Registering devices.", b("autoApprove", "Approve new devices automatically", false), n("maxPerUser", "Devices per person", 2, "0 = no limit")) },
    /* Cursor 2026-10-23: Departments live under HR → Departments & Designations. */
    "User & Role Management": { type: "it", note: "Accounts, roles and departments.", links: [["User accounts", "settings.html#open=User%20Accounts"], ["Roles & Permissions", "settings.html#open=Roles%20%26%20Permissions"], ["Departments & Designations", "hr.html#organization"], ["Who has access", "it.html#people"]] },
    "Authentication & Login Security": { type: "it", note: "Sign-in rules for this company.", links: [["Session Timeout", "settings.html?in=it#open=Session%20Timeout"], ["Active Sessions", "settings.html?in=it#open=Active%20Sessions"], ["Password Policy", "settings.html?in=it#open=Password%20Policy"]],
      managed: "Passwords, two-factor sign-in, account lockout and single sign-on are handled by VEYORA's sign-in service for every company. Session timeout is applied per company." },
    "Security & Audit Logs": { type: "it", note: "Who did what: settings changes, clock-in checks, devices, assets and tickets.", links: [["IT activity log", "it.html#log"], ["Settings audit log", "settings.html#open=Audit%20Logs"]] },
    "Module & Feature Management": { type: "it", note: "Hide modules from the sidebar when they are off. Owners and admins can still open Settings to turn them back on.",
      base: F("Live modules. Turning one off hides it from the menu for staff.", b("operations", "Operations", true), b("schedules", "Schedules", true), b("fleet", "Fleet", true), b("passengers", "Passengers", true), b("finance", "Finance", true), b("reportHub", "Reports", true), b("hr", "HR & Crew", true), b("agreements", "Agreements (under HR)", true), b("payroll", "Payroll & Overtime (under HR)", true), b("reports", "HR Reports (under HR)", true), b("it", "IT", true), b("maintenance", "Maintenance", true)) },
    "API & Integration Management": { type: "it", note: "Connections to other systems and data import/export.",
      managed: "VEYORA does not yet expose a public API for companies. Sign-in and invite emails are sent by the platform. Connect a company email or SMS sender under Integrations when you are ready.",
      links: [["Email Service Configuration", "settings.html?in=it#open=Email%20Service%20Configuration"], ["SMS Provider Configuration", "settings.html?in=it#open=SMS%20Provider%20Configuration"], ["Import Data", "settings.html?in=it#open=Import%20Data"], ["Export Data", "settings.html?in=it#open=Export%20Data"]] },
    "Database & Backup Management": { type: "it", managed: "Your data is kept in VEYORA's managed database, shared by all companies. Backups and restores are handled by VEYORA for the whole platform and cannot be scheduled per company. Ask your VEYORA administrator if you need a restore." },
    "System Monitoring & Maintenance": { type: "it", managed: "Server, database and scheduled-job health is looked after by VEYORA for all companies. It cannot be set per company." },
    "Alerts & Notifications": { type: "it", note: "In-app alerts for IT (owners, admins and IT staff).", links: [["IT activity log", "it.html#log"]],
      base: F("IT alerts.", b("network", "Alert when someone tries to clock in from an unapproved network", true), b("device", "Alert when someone tries to clock in from an unapproved or blocked device", true), b("newDevice", "Alert when a device waits for approval", true), b("tickets", "Alert on new support tickets", true)) },
    "IT Asset Management": { type: "it", note: "Computers, phones, servers, network kit and software licences.", links: [["Asset register", "it.html#assets"]], base: F("Reminders.", n("warrantyDays", "Warn before warranty ends", 30, "days"), n("renewDays", "Warn before a licence renews", 30, "days")) },
    "Temporary Access & Approvals": { type: "it", note: "Extra access for a person is granted by changing their role.",
      managed: "Time-limited access requests are not available yet. To give someone IT or admin access, change their role under User accounts. To take it away, change the role back or suspend the account.",
      links: [["User accounts", "settings.html#open=User%20Accounts"], ["Roles & Permissions", "settings.html#open=Roles%20%26%20Permissions"], ["Who has access", "it.html#people"]] },
    "Network Diagnostics": { type: "it", note: "Check which network you are on and whether it is approved.", links: [["Run the network check", "it.html#networks"]] },
    "Data Access & Retention": { type: "it", note: "How long records are kept and who may export them.", links: [["Data Retention Policy", "settings.html?in=it#open=Data%20Retention%20Policy"], ["Export Data", "settings.html?in=it#open=Export%20Data"], ["Document Storage Settings", "settings.html?in=it#open=Document%20Storage%20Settings"]] },
    "Configuration Management": { type: "it", note: "Every settings change, who made it and when.", links: [["Settings audit log", "settings.html#open=Audit%20Logs"], ["IT activity log", "it.html#log"]] },
    "IT Support & Incident Management": { type: "it", note: "Problems staff report to IT, with priority, status and replies. Answer times set the due time on each new ticket.", links: [["Support tickets", "it.html#tickets"]],
      base: F("Answer within (hours). Used when a ticket is opened.", n("urgent", "Urgent", 4, "hours"), n("high", "High", 24, "hours"), n("normal", "Normal", 72, "hours"), n("low", "Low", 168, "hours")) },
    "Email & System Services": { type: "it", note: "Outgoing email and SMS.", links: [["Email Service Configuration", "settings.html?in=it#open=Email%20Service%20Configuration"], ["SMS Provider Configuration", "settings.html?in=it#open=SMS%20Provider%20Configuration"]],
      managed: "Sign-in and invite emails are sent by VEYORA's sign-in service. Company email and SMS use the provider you choose under Integrations (no secrets are stored here)." },
    "Security Policies": { type: "it", note: "Company rules for administrators and staff. Applied on HR, roster, IT and Settings pages.",
      base: F("Policies.", b("adminNetwork", "Administrators and HR must use an approved network for HR, roster, IT and Settings pages", false), b("emergency", "Allow the owner emergency access from any network", true), x("notes", "Your security policy (shown on the IT overview)", "")) },

    /* 9 HR & Crew */
    "Designations": { type: "hr-designations", note: "Job titles used across HR. Link each title to a department — Employees directory tabs follow departments." },
    "Allowance Rules": { type: "hr-allowance-rules", note: "Allowances the app works out in every pay run: who gets them, when, and how much." },
    "Approvers & Responsibilities": { type: "hr-approvers", note: "Pick the people who decide each kind of request." },
    "Directory Tabs, Filters & Columns": F("What the HR & Crew directory shows.",
      b("tabCaptains", "Tab: Captains", true), b("tabDeck", "Tab: Deck crew", true), b("tabEngineering", "Tab: Engineering", true), b("tabShore", "Tab: Shore staff", false),
      s("defaultTab", "Open on tab", ["All staff", "Captains", "Deck crew", "Engineering", "Shore staff"], "All staff"),
      s("sort", "Sort staff by", ["Name", "Position", "Duty status", "Certificate expiry"], "Name"),
      b("fRole", "Filter: designation", true), b("fStatus", "Filter: duty status", true), b("fDept", "Filter: department", false), b("fEmployment", "Filter: employment type", false),
      b("cVessel", "Column: assigned vessel", true), b("cCert", "Column: certification", true), b("cValid", "Column: valid until", true),
      b("cDept", "Column: department", false), b("cEmpNo", "Column: employee ID", false), b("cEmployment", "Column: employment type", false), b("cStart", "Column: start date", false)),
    "Employee Categories": L(["Management", "Marine crew", "Engineering", "Shore operations", "Administration"]),
    "Crew Positions": L(["Captain", "Crew", "Cashier", "First Mate", "Chief Engineer", "Engineer", "Deckhand", "Purser", "Safety Officer"]),
    "Vessel Map": F("How vessel positions from phones show on the Live Vessel Map.", b("holdOnLand", "When a phone is on land, keep the vessel at its last position at sea", true)),
    "Attendance Rules": F("Attendance tracking.", n("late", "Late after", 10, "minutes"), n("absent", "Absent after", 60, "minutes"), b("geo", "Require location check-in", false), b("approval", "Manual corrections need approval", true), b("breaks", "Allow breaks (Break in / Break out after clocking in)", false), n("break_minutes", "Break allowance per day", 60, "minutes (0 = no limit)")),
    "Shift Swap Rules": F("Staff asking a colleague to swap a day's shift (iOS app: Quick access → Shift change). The colleague must accept first.", b("enabled", "Allow shift swap requests", true), b("hod", "Swaps need approval after the colleague accepts", true), s("scope", "Staff can swap with", ["Anyone", "Same designation", "Same crew group"], "Same designation"), n("notice", "Minimum notice before the shift", 0, "hours")),
    "Shift Definitions": T("Your duty shifts: name, code, start and end time. The code shows in the Duty Roster grid; Crew needed is how many people each shift needs per day (0 = no target); Break is unpaid minutes taken off the shift hours; For limits who the shift is meant for. Team per shift lists who each shift needs, e.g. 1 Captain, 2 Crew, 1 Cashier (names match designations); it replaces Crew needed.",
      [{ k: "name", l: "Shift" }, { k: "code", l: "Code", d: "" }, { k: "start", l: "Starts", t: "time", d: "06:00" }, { k: "end", l: "Ends", t: "time", d: "14:00" },
       { k: "color", l: "Colour", t: "color", o: SHIFT_COLORS, d: "Green" }, { k: "needed", l: "Crew needed", t: "number", d: 0, min: 0 },
       { k: "brk", l: "Break (min)", t: "number", d: 0, min: 0 }, { k: "group", l: "For", t: "select", o: ["Everyone", "Captain", "Deck", "Engineering", "Shore"], d: "Everyone" },
       { k: "team", l: "Team per shift", d: "1 Captain, 2 Crew, 1 Cashier" }],
      [{ name: "Day Shift", code: "D", start: "06:00", end: "14:00", color: "Green", needed: 0, team: "1 Captain, 2 Crew, 1 Cashier" }, { name: "Evening Shift", code: "E", start: "14:00", end: "22:00", color: "Amber", needed: 0, team: "1 Captain, 2 Crew, 1 Cashier" },
       { name: "Night Shift", code: "N", start: "22:00", end: "06:00", color: "Blue", needed: 0, team: "1 Captain, 2 Crew, 1 Cashier" }], "shift"),
    "Duty Roster": F("How the Duty Roster page behaves.",
      s("weekend", "Weekend days", ["Friday & Saturday", "Saturday & Sunday", "Friday only", "None"], "Friday & Saturday"),
      s("view", "Default view", ["Week", "Two weeks", "Month"], "Week"),
      b("showLeave", "Show approved leave as L automatically", true), b("lockPast", "Lock past days", false),
      b("warnRest", "Warn when rest between shifts is too short", true), b("warnConsecutive", "Warn on too many working days in a row", true), b("warnWeekly", "Warn when weekly hours are over the limit", true)),
    "Roster Patterns": T("Repeating patterns you can apply to crew from the Templates tab. Use shift codes separated by commas, e.g. D,D,D,D,OFF,OFF.",
      [{ k: "name", l: "Pattern" }, { k: "pattern", l: "Shift codes" }, { k: "note", l: "Good for" }],
      PATTERN_LIBRARY.slice(0, 8), "pattern"),
    "Duty Hours": F("Duty-time limits.", n("daily", "Maximum daily duty", 12, "hours"), n("weekly", "Maximum weekly duty", 60, "hours"), n("rest", "Minimum daily rest", 8, "hours"), n("consecutive", "Maximum consecutive days", 6)),
    "Overtime Rules": F("Overtime pay. Overtime only counts once HR approves the week's timesheet.", b("enabled", "Overtime allowed", true), n("after", "Overtime starts after", 8, "hours/day"), n("rate", "Rate multiplier", 1.25), n("holidayRate", "Holiday multiplier", 2)),
    "Leave Types & Policies": T("Leave types staff can request. Days per year is the yearly entitlement for the type, with or without a certificate (0 = no limit). Medical certificate: Optional lets the person choose; Required means every request must come with one. For Optional, Days without certificate is how many of the yearly days may be taken without one, and Max days in a row without certificate is the longest stretch before a certificate is needed (0 = no limit for either). Certificate file required makes staff attach a photo or PDF of the certificate when they ask with one. Staff see this when they ask; the database enforces it on the website and in the apps.",
      [{ k: "name", l: "Leave type" }, { k: "days", l: "Days per year", t: "number", d: 0, min: 0 }, { k: "paid", l: "Paid", t: "toggle", d: true }, { k: "note", l: "Note required", t: "toggle", d: false },
       { k: "cert", l: "Medical certificate", t: "select", o: ["Not applicable", "Optional", "Required"], d: "Not applicable" },
       { k: "nocert", l: "Days without certificate", t: "number", d: 0, min: 0 }, { k: "nocertRun", l: "Max days in a row without certificate", t: "number", d: 0, min: 0 },
       { k: "certFile", l: "Certificate file required", t: "toggle", d: false }],
      [{ name: "Annual leave", days: 30, paid: true, note: false }, { name: "Sick leave", days: 30, paid: true, note: false, cert: "Optional", nocert: 5, nocertRun: 2 }, { name: "Personal leave", days: 5, paid: true, note: true },
       { name: "Maternity leave", days: 60, paid: true, note: false }, { name: "Paternity leave", days: 3, paid: true, note: false }, { name: "Unpaid leave", days: 0, paid: false, note: true }], "leave type"),
    "Leave Approval Workflow": approval("leave requests", "HR"),
    "Crew Qualification Types": T("Certificates and licences HR records. Validity fills in the expiry date (0 = no expiry). Required for flags people who are missing it.",
      [{ k: "name", l: "Qualification" }, { k: "months", l: "Valid for (months)", t: "number", d: 24, min: 0 }, { k: "required", l: "Required for", t: "select", o: ["All crew", "Captain", "Deck", "Engineering", "Shore", "None"], d: "None" }],
      [{ name: "Master licence", months: 60, required: "Captain" }, { name: "Engineer licence", months: 60, required: "Engineering" }, { name: "STCW Basic", months: 60, required: "All crew" },
       { name: "First aid", months: 36, required: "None" }, { name: "Radio operator", months: 60, required: "Captain" }, { name: "Fire fighting", months: 60, required: "None" }, { name: "Security awareness", months: 24, required: "None" }], "qualification"),
    "License & Certificate Expiry Alerts": F("Warn before expiry.", n("first", "First alert", 90, "days before"), n("second", "Second alert", 30, "days before"), n("final", "Final alert", 7, "days before"), s("audience", "Notify", ["Employee & HR", "Employee, HR & manager", "HR only"], "Employee, HR & manager")),
    "Crew Assignment Rules": F("Assigning crew.", b("qualified", "Only qualified crew (off = allow, with a warning mark)", false), b("expired", "Block crew with expired certificates (off = allow, with a warning mark)", false), b("rest", "Respect rest rules", true), n("minCrew", "Default minimum crew", 3)),
    "HR Document Categories": L(["Contract", "ID / Passport", "Licence", "Medical", "Training certificate", "Disciplinary", "Other"]),

    /* 10 Finance — Cursor 2026-10-24: organised under Finance → Finance Settings sections. */
    "Base Currency": F("Default reporting currency and decimal places.", s("base", "Default currency", ["MVR", "USD", "EUR", "GBP", "LKR", "INR", "AED", "SGD"], "MVR"), n("decimals", "Currency decimal places", 2)),
    "Supported Currencies": L(["MVR", "USD", "EUR"]),
    "Tax Configuration": F("Tax registration and pricing. Rates are a separate list (tax types).", b("inclusive", "Prices include tax", true), t("taxId", "Tax registration number", ""), t("name", "Primary tax name (legacy)", "GST"), n("rate", "Primary rate % (legacy)", 8, "%")),
    "Tax Rates": T("Configurable tax types and rates. Used on invoices and receipts.", [{ k: "name", l: "Tax type", t: "text" }, { k: "rate", l: "Rate %", t: "number" }, { k: "active", l: "Active", t: "toggle" }], [{ name: "GST", rate: 8, active: true }, { name: "Exempt", rate: 0, active: true }], "Tax type"),
    "Revenue Categories": T("Income labels for the ledger and reports.", [{ k: "name", l: "Category", t: "text" }, { k: "active", l: "Active", t: "toggle" }], [{ name: "Ticket sales", active: true }, { name: "Charter services", active: true }, { name: "Other income", active: true }], "Category"),
    "Expense Categories": T("Spend labels for the ledger and reports.", [{ k: "name", l: "Category", t: "text" }, { k: "active", l: "Active", t: "toggle" }], [{ name: "Fuel", active: true }, { name: "Repairs", active: true }, { name: "Salaries", active: true }, { name: "Utilities", active: true }, { name: "Supplies", active: true }], "Category"),
    "Category Defaults": F("Defaults when importing or posting transactions.", t("revenueImport", "Default revenue category", "Ticket sales"), t("expenseImport", "Default expense category", "Fuel")),
    "Payment Methods": L(["Cash", "Bank transfer", "Card", "Online gateway", "Mobile wallet", "Invoice"]),
    "Finance Accounts": T("Cash and bank accounts used for reconciliation.", [{ k: "name", l: "Account", t: "text" }, { k: "type", l: "Type", t: "select", o: ["Cash", "Bank"] }, { k: "currency", l: "Currency", t: "text" }, { k: "active", l: "Active", t: "toggle" }], [{ name: "Main cash", type: "Cash", currency: "MVR", active: true }, { name: "Operating bank", type: "Bank", currency: "MVR", active: true }], "Account"),
    "Reconciliation Settings": F("How payments are matched to bank and cash records.", b("requireAccount", "Require an account on paid bookings", false), n("matchDays", "Auto-match window", 3, "days"), b("warnUnmatched", "Warn on unmatched payments", true)),
    "Invoice Number Format": fmt("INV", "invoice numbers"),
    "Receipt Number Format": fmt("RCT", "receipt numbers"),
    "Document Branding": F("Company details shown on invoices and receipts.", b("showLogo", "Show company logo", true), b("showAddress", "Show office address", true), b("showReg", "Show registration number", true), x("footer", "Default document footer", "")),
    "Payment Terms": F("Default invoice payment terms.", n("days", "Payment due in", 14, "days"), x("note", "Default invoice notes", "Payment is due within the stated terms. Thank you for your business.")),
    "Financial Approval Limits": F("Approval thresholds. Amounts are in the company base currency.", n("expense", "Expense approval limit", 5000), n("payment", "Payment approval limit", 20000), n("purchase", "Purchase approval threshold", 10000), n("refund", "Refund approval threshold", 2000), s("above", "Above limits escalate to", ["Owner", "Admin"], "Owner"), b("separate", "Requester cannot approve their own", true), n("admin", "Admin (legacy)", 50000), n("operations", "Operations (legacy)", 5000), n("hr", "HR (legacy)", 5000)),
    "Budget Categories": L(["Operations", "Fuel", "Payroll", "Maintenance", "Capital", "Administration"]),
    "Financial Periods": F("Fiscal calendar and date display for finance records.", s("start", "Financial year starts", ["January", "April", "July", "October"], "January"), s("period", "Reporting period", ["Monthly", "Quarterly"], "Monthly"), s("dateFormat", "Date format for financial records", ["DD/MM/YYYY", "YYYY-MM-DD", "MM/DD/YYYY"], "DD/MM/YYYY"), b("lock", "Lock closed periods", true)),
    "Payroll Configuration": F("How payroll is worked out in HR. Finance only posts approved runs. On a monthly cycle, set the pay period as a range. The 1st to the end of the month is a calendar month. 16 to 15 starts on the 16th and ends on the 15th of the next month. When the end day is earlier than the start day, the period always finishes in the next month. People employed for the whole period get a full month's salary. The salary bank and account are written on the debit instruction letter.", s("cycle", "Pay cycle", ["Monthly", "Fortnightly", "Weekly"], "Monthly"), s("fromDay", "Period starts on day", PAY_DAYS, "1"), s("toDay", "Period ends on day", ["End of the month"].concat(PAY_DAYS), "End of the month"), n("day", "Pay day of month", 25),
      t("salaryBank", "Bank that pays salaries", "Bank of Maldives"), t("salaryAccount", "Company account number to debit", "", "13 digits for Bank of Maldives"),
      b("approval", "A second person must approve payroll", true), n("hours", "Standard hours per month (for the hourly overtime rate)", 208, "hours"),
      n("pensionEmployee", "Staff pension (taken from pay)", 7, "%"), n("pension", "Employer pension", 7, "%"), b("absence", "Take unapproved absences off pay", false)),
    "Payroll Finance Posting": F("How approved payroll appears in Finance. Calculations stay in HR & Crew.", t("expenseCategory", "Payroll expense category", "Salaries"), t("account", "Salary expense account", "Payroll clearing"), s("method", "Default payroll payment method", ["Bank transfer", "Cash"], "Bank transfer"), s("posting", "Posting period", ["Pay period end", "Pay day", "Manual"], "Pay period end"), b("exportOnlyApproved", "Only export approved payroll runs", true)),
    "Financial Report Preferences": F("Defaults for finance reports and reconciliation.", s("format", "Default export format", ["PDF", "Excel", "CSV"], "PDF"), s("range", "Default report period", ["This month", "Last month", "This quarter", "This year"], "This month"), b("zero", "Show zero lines", false), b("trackUnpaid", "Track unpaid invoices", true), b("reconcileRules", "Apply payment reconciliation rules", true)),

    /* 11 Maintenance */
    "Maintenance Categories": L(["Preventive", "Corrective", "Emergency", "Inspection", "Overhaul", "Dry-docking"]),
    "Maintenance Job Types": L(["Engine service", "Hull cleaning", "Safety equipment check", "Electrical", "Navigation equipment", "Painting", "Propeller", "Cabin repair"]),
    "Service Interval Rules": F("Service intervals.", n("engineHours", "Engine service every", 250, "hours"), n("hullMonths", "Hull inspection every", 6, "months"), n("safetyMonths", "Safety equipment check every", 3, "months"), n("drydock", "Dry-dock every", 24, "months")),
    "Preventive Maintenance Schedules": { type: "it", note: "Recurring services per vessel and engine, by date and/or running hours. They are set up on each vessel.", links: [["Preventive schedules", "maintenance.html#schedules"], ["Vessels", "maintenance.html#vessels"]] },
    "Defect Categories": L(["Engine", "Hull", "Electrical", "Navigation", "Safety equipment", "Cabin", "Other"]),
    "Priority Levels": { type: "it", managed: "Work orders use four priorities: Critical, High, Medium and Low. Critical defects can take a vessel out of service (Return to Service Rules)." },
    "Work Order Statuses": { type: "it", managed: "Draft → Open → Assigned → In progress → Awaiting parts → Awaiting approval → Completed → Closed. Jobs that need approval stop at Awaiting approval until a maintenance approver signs them off." },
    "Inspection Checklist Templates": { type: "it", note: "Daily, weekly, pre-departure and post-arrival checklists. Failed items create defects automatically.", links: [["Checklists & inspections", "maintenance.html#inspections"]] },
    "Return to Service Rules": F("When a vessel may operate again.", b("autoOut", "Take a vessel out of service when a defect that stops operation is reported", true),
      b("authorize", "Only maintenance approvers can return a vessel to service", true), b("requireInspection", "Require a passed inspection after a repair that stopped operation", false),
      b("blockAssign", "Stop crew being assigned to a vessel that is out of service", true)),
    "Maintenance Permissions": { type: "it", note: "Owners, admins and Operations run maintenance. Name extra people (engineers, technical superintendents) under Maintenance approvals; they can manage maintenance and approve work. Everyone can report defects, log engine hours and submit inspections.", links: [["Approvers & Responsibilities", "hr.html#employees/settings/approvers"]] },
    "Units of Measurement": L(["Each", "Litre", "Kg", "Metre", "Set", "Box", "Hour"], "Units for spare parts and consumables."),
    "Labour Rates & Cost Categories": F("Used on work orders: labour cost is suggested from hours × rate (contractor rate when a contractor is named).", n("rate", "Standard labour rate", 0, "per hour"), n("contractorRate", "Contractor labour rate", 0, "per hour"), x("cats", "Cost categories (one per line, for notes)", "Labour\nParts\nContractor\nTransport\nOther")),
    "Maintenance Document Requirements": F("Photos and reports on Maintenance.", b("photoDefect", "Require a photo or video when reporting a Critical defect", false), b("reportClose", "Require at least one file (service report or photo) before closing a contractor work order", false)),
    "Work Order Number Format": fmt("WO", "work orders"),
    "Maintenance Approval Rules": approval("maintenance work", "Operations"),
    "Spare Parts Categories": L(["Engine parts", "Filters", "Electrical", "Safety gear", "Consumables", "Hull & deck"]),
    "Maintenance Reminder Rules": F("Reminders for upcoming work, to owners, admins, Operations and the people named for Maintenance approvals.", n("first", "Show as due", 14, "days before"), n("hoursWarn", "Show as due", 25, "running hours before"), b("overdue", "Daily reminder when overdue", true)),

    /* 12 Notifications */
    "Email Notifications": F("Email delivery.", b("enabled", "Send email notifications", true), s("digest", "Digest", ["Instant", "Hourly", "Daily"], "Instant"), tm("quietFrom", "Quiet hours from", "22:00"), tm("quietTo", "Quiet hours to", "06:00")),
    "In-App Notifications": F("In-app delivery.", b("enabled", "Show in-app notifications", true), b("sound", "Play sound", false), n("keep", "Keep for", 30, "days")),
    "Push Notifications": F("Push delivery.", b("enabled", "Send push notifications", false), b("critical", "Critical alerts only", true)),
    "Trip Reminders": F("Reminders before trips.", n("crew", "Remind crew", 60, "minutes before"), n("passengers", "Remind passengers", 120, "minutes before"), b("passengersOn", "Send passenger reminders", true)),
    "Schedule Change Alerts": notif("schedule change alerts"),
    "Vessel Maintenance Alerts": notif("maintenance alerts"),
    "Certificate Expiry Alerts": notif("certificate expiry alerts"),
    "Leave Approval Notifications": notif("leave approval notifications"),
    "Financial Approval Alerts": notif("financial approval alerts"),
    "Notification Recipients": M("Who receives each kind of alert.", ROLES, ["Operations", "Schedules", "Maintenance", "Certificates", "Leave", "Finance"], function (r) { return r === "Admin"; }),
    "Notification Templates": F("Message wording. Use {company}, {trip}, {date}.", t("tripSubject", "Trip reminder subject", "Reminder: {trip} departs soon"), x("tripBody", "Trip reminder body", "Hello, your trip {trip} on {date} is about to depart. — {company}"), t("changeSubject", "Schedule change subject", "Schedule change for {trip}"), x("changeBody", "Schedule change body", "The schedule for {trip} on {date} has changed. — {company}")),

    /* 13 Approvals */
    "Trip Cancellation Approval": approval("trip cancellations", "Operations"),
    "Schedule Change Approval": approval("schedule changes", "Operations"),
    "Crew Assignment Approval": approval("crew assignments", "Operations"),
    "Leave Approval": approval("leave", "Admin"),
    "Expense Approval": approval("expenses", "Admin"),
    "Payment Approval": approval("payments", "Admin"),
    "Payroll Approval": approval("payroll", "Owner"),
    "Maintenance Approval": approval("maintenance", "Operations"),
    "Approval Limits": F("Value thresholds per request type.", n("expense", "Expense limit", 5000), n("payment", "Payment limit", 20000), n("maintenance", "Maintenance limit", 10000), n("payroll", "Payroll runs above", 0)),
    "Escalation Rules": F("When approvals stall.", n("after", "Escalate after", 48, "hours"), s("to", "Escalate to", ["Owner", "Admin"], "Owner"), b("remind", "Remind approver before escalating", true)),
    "Approval History": I("Approvals will be listed here once requests are submitted in the modules."),

    /* 14 Security — passwords, MFA, SSO and lockout are run by VEYORA sign-in; Session Timeout and Active Sessions are live. */
    "Password Policy": { type: "it", managed: "Staff passwords are set by VEYORA's sign-in service for every company (minimum length and recovery). Custom length, complexity and expiry rules per company are not available yet." },
    "Two-Factor Authentication": { type: "it", managed: "Two-factor sign-in is handled by VEYORA's sign-in service when enabled for the platform. It cannot be turned on or off per company here yet." },
    "Single Sign-On": { type: "it", managed: "Company SSO (Microsoft, Google or SAML) is set up by the VEYORA platform owner. " + SEC },
    "Session Timeout": F("Idle timeout. Applied after you save: people are signed out after this many minutes without activity.", n("idle", "Sign out after inactivity", 60, "minutes"), n("max", "Maximum session length (informational)", 12, "hours"), b("remember", "Allow Remember me (sign-in page)", true)),
    "Login Restrictions": { type: "it", note: "Where staff may work in the app. Page and clock-in network rules live under Network & IP Restrictions.",
      managed: "Email-domain and working-hours sign-in locks are not enforced by the platform yet. Use Network & IP Restrictions for office/VPN page and clock-in rules.",
      links: [["Network & IP Restrictions", "settings.html?in=it#open=Network%20%26%20IP%20Restrictions"], ["Security Policies", "settings.html?in=it#open=Security%20Policies"]] },
    "Failed Login Protection": { type: "it", managed: "Lockout after failed passwords is handled by VEYORA's sign-in service for every company." },
    "Active Sessions": { type: "sessions" },
    "Trusted Devices": { type: "it", note: "Phones and computers used for clock-in.",
      managed: "Browser \"trusted device\" remember-me is not separate from Session Timeout yet. Register and approve attendance devices under Device Management.",
      links: [["Device Management", "settings.html?in=it#open=Device%20Management"], ["Devices", "it.html#devices"], ["Session Timeout", "settings.html?in=it#open=Session%20Timeout"]] },
    "API Access": { type: "it", managed: "VEYORA does not yet expose a public company API. Export your settings under Export Data. " + SEC,
      links: [["Export Data", "settings.html?in=it#open=Export%20Data"], ["API & Integration Management", "settings.html?in=it#open=API%20%26%20Integration%20Management"]] },
    "Security Event Logs": { type: "audit", note: "Security-relevant changes to company settings." },

    /* 15 Integrations */
    "Email Service Configuration": F("Sender identity for company email (not sign-in mail). " + SEC + " Sign-in and invite emails stay on VEYORA's sign-in service.", s("provider", "Provider", ["Not configured", "Resend", "Brevo", "SMTP"], "Not configured"), t("fromName", "From name", ""), t("fromEmail", "From email", ""), t("replyTo", "Reply-to email", "")),
    "SMS Provider Configuration": F("SMS sender identity. " + SEC, s("provider", "Provider", ["Not configured", "Twilio", "Dhiraagu", "Ooredoo", "Other"], "Not configured"), t("sender", "Sender ID", "")),
    "Microsoft 365 Integration": { type: "it", managed: "Microsoft 365 calendar and directory sync is not connected yet. " + SEC },
    "External API Connections": { type: "it", managed: "Named connections to other systems are not available yet. Use Export Data for a settings backup." },
    "Import Data": { type: "import" },
    "Export Data": { type: "export" },
    "Backup Configuration": { type: "it", managed: "Platform backups are run by VEYORA for all companies. You cannot schedule a separate company backup. Use Export Data for a downloadable copy of settings." },
    "Data Retention Policy": F("How long records should be kept. Used as your company policy; automatic deletion is not run yet.", n("trips", "Trip records", 7, "years"), n("finance", "Financial records", 10, "years"), n("hr", "HR records", 7, "years"), n("logs", "Audit logs", 2, "years")),
    "Document Storage Settings": F("Uploaded staff documents on HR & Crew.", n("maxMb", "Maximum file size", 10, "MB"), s("types", "Allowed files", ["PDF & images", "PDF, images & Office", "Any"], "PDF & images"), b("virus", "Scan uploads (when scanning is enabled on the platform)", true)),
    "Data Import History": I("Imports will be listed here once bulk import is used."),
    "Integration Logs": I("Integration activity will appear here once an integration is enabled."),

    /* 16 System */
    "Appearance & Theme": F("Look and feel.", s("accent", "Accent colour", ["Ocean blue", "Teal", "Indigo", "Slate"], "Ocean blue"), s("radius", "Corner style", ["Rounded", "Compact"], "Rounded"), b("animations", "Animations", true)),
    "Light / Dark Mode": F("Colour mode.", s("mode", "Mode", ["Light", "Dark", "Match system"], "Light")),
    "Date & Time Formats": F("Display formats.", s("time", "Time format", ["24-hour", "12-hour"], "24-hour"), s("week", "Week starts", ["Saturday", "Sunday", "Monday"], "Sunday"), s("number", "Number format", ["1,234.56", "1.234,56"], "1,234.56")),
    "Dashboard Preferences": F("Dashboard widgets.", b("trips", "Today's trips", true), b("fleet", "Fleet status", true), b("alerts", "Alerts", true), b("finance", "Finance summary", true), b("crew", "Crew on duty", true)),
    "Table & List Preferences": F("Tables and lists.", n("rows", "Rows per page", 25), b("compact", "Compact rows", false), b("sticky", "Sticky headers", true)),
    "Default Landing Page": F("Page shown after sign-in.", s("page", "Landing page", MODULES, "Dashboard")),
    "Audit Logs": { type: "audit", note: "Every settings change, with who made it." },
    "System Activity History": { type: "audit", note: "Recent activity in this company." },
    "Custom Fields": L([], "Extra fields you want on records, e.g. Vessel: Hull colour."),
    "Numbering Sequences": F("Shared numbering behaviour.", b("reset", "Reset sequences each year", true), b("gaps", "Allow gaps in sequences", false), n("pad", "Default padding", 6)),
    "Archived Records": I("Archived records will be listed here. Nothing has been archived yet."),
    "System Maintenance": F("Planned maintenance window.", b("enabled", "Show maintenance banner", false), x("message", "Message", "VEYORA will be briefly unavailable for maintenance."), tm("from", "From", "02:00"), tm("to", "To", "03:00")),
    "Subscription & Billing": { type: "subscription", note: "Plan, price and trial for this company. Loaded from the database." },
    "Help & Support": { type: "info", text: "Need help? Contact your VEYORA administrator. A help center is coming soon." },

    /* 16 Agreements & Documents (HR can change these too) */
    "Agreement Categories": L(["Employment", "Offer letter", "Charter", "Transfer service", "Vendor / supplier", "Non-disclosure", "General"], "Groups for agreements and templates."),
    "Agreement Numbering": F("Pattern for agreement numbers. Example: AGR-2026-0001", t("prefix", "Prefix", "AGR"), s("sep", "Separator", ["-", "/", "none"], "-"), b("year", "Include year", true), n("digits", "Sequence digits", 4)),
    "Agreement PDF Layout": F("How the saved PDF looks.", s("size", "Page size", ["A4", "Letter"], "A4"), b("logo", "Show company name and logo at the top", true), s("font", "Font", ["Sans-serif", "Serif"], "Sans-serif"), t("footer", "Footer text", "", "e.g. Confidential")),
    "Agreement Reminders": F("When signed agreements count as ending soon.", n("expiry", "Show as ending soon", 30, "days before the end date"))
  };

  /* 17 Platform owner (stored in platform_settings.config) */
  var P = {
    "Company Registration & Onboarding": F("How companies join the platform.", b("open", "Allow public company registration", true), b("verifyEmail", "Require email verification", true), t("welcome", "Welcome message", "Welcome to VEYORA.")),
    "Company Approval": { type: "platform-approval" },
    "Company Suspension & Reactivation": F("Suspension policy.", b("notify", "Notify the company owner", true), x("reason", "Default suspension message", "Your company is suspended. Contact the VEYORA platform owner.")),
    "Company Subscription Plans": L(["Preview (free)", "Starter", "Professional", "Enterprise"], "Plans offered to companies."),
    "Subscription Limits": F("Limits applied to the preview plan.", n("staff", "Max staff per company", 25), n("vessels", "Max vessels per company", 20), n("storage", "Document storage", 1, "GB")),
    "Platform-Wide Roles & Permissions": M("Default role capabilities for new companies.", ROLES, ACTIONS, function (r, c) { return r === "Admin" || c === "View"; }),
    "Platform Security Policies": F("Rules applied to every company.", n("minPassword", "Minimum password length", 8), b("require2fa", "Require 2FA for company owners", false), n("session", "Maximum session length", 12, "hours")),
    "Global Integrations": F("Platform-wide providers. " + SEC, s("email", "Email provider", ["Not configured", "Resend", "Brevo", "SMTP"], "Not configured"), s("sms", "SMS provider", ["Not configured", "Twilio", "Other"], "Not configured")),
    "Platform Audit Logs": { type: "platform-audit" },
    "System Health & Monitoring": { type: "platform-health" }
  };


  /* Responsibilities people can be named for (Settings > HR & Crew Settings > Approvers & Responsibilities). */
  window.VEYORA_DUTIES = [
    { k: "passengers", l: "Passenger services", d: "Looks after passengers on the day: questions, complaints and special assistance." },
    { k: "manifest", l: "Passenger list & manifests", d: "Checks and signs off the passenger list before departure." },
    { k: "bookings", l: "Bookings & refunds", d: "Approves refunds and booking changes." },
    { k: "trip_cancel", l: "Trip cancellations", d: "Approves cancelling a trip." },
    { k: "schedule", l: "Schedule changes", d: "Approves timetable changes." },
    { k: "safety", l: "Dispatch & safety sign-off", d: "Gives the go-ahead before a vessel sails." },
    { k: "crew_assign", l: "Crew assignments", d: "Approves crew rosters and swaps.", live: true },
    { k: "certificates", l: "Certificate renewals", d: "Follows up on expiring crew certificates." },
    { k: "incidents", l: "Incident reports", d: "Receives and reviews incident reports." },
    { k: "maintenance", l: "Maintenance approvals", d: "Runs maintenance, approves work orders and returns vessels to service.", live: true },
    { k: "expenses", l: "Expenses", d: "Approves expense claims." },
    { k: "payments", l: "Payments", d: "Approves outgoing payments." },
    { k: "payroll", l: "Payroll", d: "Approves payroll runs. If nobody is named, HR, owners and admins approve.", live: true }
  ];
  window.VEYORA_DEFS = D;
  window.VEYORA_PLATFORM_DEFS = P;
  window.VEYORA_PLATFORM_ITEMS = Object.keys(P);
  void role; void DAYS;
})();
