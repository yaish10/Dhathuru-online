/* Notice Types: one settings section for every kind of notification the system sends.
   Each section edits one block of the company setting 11_notice_types (see migration 0078): send it or not, keep the people the
   system would normally tell, and add teams and designations (optionally only people on the duty roster that day).
   Loaded after settings-data.js, settings-defs.js and settings-help.js; adds the "Notice Types" category and its sections. */
(function () {
  /* [kind, section title, group, when it is sent, who gets it by default, personal?]  personal = addressed to the person concerned */
  var N = [
    ["new_booking", "New Booking Notice", "Bookings", "A booking is made for a trip.", "The trip's captain and assigned crew (Operations when nobody is assigned yet).", false],
    ["passenger_added", "Passenger Added Notice", "Bookings", "A passenger is added to an existing booking.", "The trip's captain and assigned crew (Operations when nobody is assigned yet).", false],
    ["booking_cancelled", "Booking Cancelled Notice", "Bookings", "A booking is cancelled.", "The trip's captain and assigned crew (Operations when nobody is assigned yet).", false],
    ["trip", "Trip Status Notice", "Trips", "A trip departs, is delayed, cancelled, arrives or has not departed on time.", "Operations, the trip's captain and crew.", false],
    ["ops_advisory", "Operations Advisory Notice", "Trips", "An advisory (weather, closure, delay) is published.", "The captain and crew of the trips it applies to.", false],
    ["leave_request", "Leave Request Notice", "Leave", "Someone submits a leave request.", "The approvers for that person (Leave settings → Approvers & routing).", false],
    ["leave_decision", "Leave Decision Notice", "Leave", "A leave request is approved or rejected.", "The person who asked.", true],
    ["leave_reminder", "Leave Reminder Notice", "Leave", "A leave request has waited too long for a decision.", "The approvers.", false],
    ["attendance_correction", "Attendance Correction Notice", "Attendance", "Someone asks for an attendance correction.", "HR.", false],
    ["attendance_decision", "Attendance Decision Notice", "Attendance", "An attendance correction is approved or rejected.", "The person who asked.", true],
    ["swap_request", "Shift Swap Request Notice", "Shift swaps", "Someone asks a colleague to swap a shift.", "The colleague asked.", true],
    ["swap_approval", "Shift Swap Approval Notice", "Shift swaps", "A swap is accepted and needs approval.", "The swap approvers.", false],
    ["swap_result", "Shift Swap Result Notice", "Shift swaps", "A swap is accepted, declined, approved or rejected.", "Both people in the swap.", true],
    ["cert_expiry", "Certificate Expiry Notice", "HR documents", "A certificate or licence is about to expire or has expired.", "The person and HR.", false],
    ["document_expiry", "Document Expiry Notice", "HR documents", "A staff document is about to expire.", "The person and HR.", false],
    ["payslip", "Payslip Notice", "Payroll", "A pay run is approved and payslips are ready.", "Each person paid in the run.", true],
    ["work_order", "Work Order Notice", "Maintenance", "A work order is assigned, needs approval, or is approved or sent back.", "The assignee, or the Maintenance team.", false],
    ["maint_plan", "Maintenance Plan Notice", "Maintenance", "Planned maintenance is scheduled or changed.", "The Maintenance team and the assignee.", false],
    ["defect", "Defect Notice", "Maintenance", "A defect or breakdown is reported.", "The Maintenance team.", false],
    ["vessel_status", "Vessel Status Notice", "Maintenance", "A vessel's status changes (restricted, out of service, back in service).", "The Maintenance team.", false],
    ["maint_due", "Maintenance Due Notice", "Maintenance", "A preventive task is due or overdue.", "The Maintenance team.", false],
    ["maint_warranty", "Warranty Notice", "Maintenance", "A component or vessel warranty is about to end.", "The Maintenance team.", false],
    ["maint_contract", "Supplier Contract Notice", "Maintenance", "A supplier agreement is about to end.", "The Maintenance team.", false],
    ["maint_budget", "Maintenance Budget Notice", "Maintenance", "Spending reaches the warning level or the budget.", "The Maintenance team.", false],
    ["low_stock", "Low Stock Notice", "Maintenance", "A spare part falls below its minimum.", "The Maintenance team.", false],
    ["purchase_request", "Purchase Request Notice", "Maintenance", "A purchase request is made or decided.", "The Maintenance team; the requester for the decision.", false],
    ["purchase_order", "Purchase Order Notice", "Maintenance", "A purchase order is placed or goods arrive.", "The requester and the work order assignee.", false],
    ["it_device", "New Device Notice", "IT", "A new device is waiting for approval.", "The IT team.", false],
    ["it_alert", "IT Alert Notice", "IT", "An IT alert is raised (for example a wrong device clock).", "The IT team.", false],
    ["it_ticket", "IT Ticket Notice", "IT", "A support ticket is opened.", "The IT team.", false],
    ["it_ticket_reply", "IT Ticket Reply Notice", "IT", "Someone replies on a ticket.", "The requester or the assignee.", true],
    ["it_ticket_assigned", "IT Ticket Assigned Notice", "IT", "A ticket is assigned to someone.", "The assignee.", true],
    ["it_ticket_done", "IT Ticket Resolved Notice", "IT", "A ticket is resolved.", "The requester.", true]
  ];
  /* Safety and compliance notices: they can be turned off, but only after a warning (the page asks first). */
  var SAFETY = ["cert_expiry", "document_expiry", "defect", "vessel_status", "ops_advisory"];
  /* personal = addressed to the person it is about. The database never lets these be switched off or dropped (notice_required, migration 0079). */
  var NOTICES = N.map(function (n) { return { kind: n[0], title: n[1], group: n[2], when: n[3], dflt: n[4], personal: n[5], tier: n[5] ? "personal" : (SAFETY.indexOf(n[0]) >= 0 ? "safety" : "team") }; });
  window.VEYORA_NOTICES = NOTICES;

  var cats = window.VEYORA_SETTINGS, defs = window.VEYORA_DEFS, help = window.VEYORA_HELP = window.VEYORA_HELP || {};
  if (!cats || !defs) return;
  NOTICES.forEach(function (n) {
    defs[n.title] = { type: "notice-type", kind: n.kind, note: n.group + " · " + n.when };
    help[n.title] = "Sent when: " + n.when.toLowerCase().replace(/^./, function (c) { return c.toLowerCase(); }) + " By default it goes to: " + n.dflt.replace(/^./, function (c) { return c.toLowerCase(); });
  });
  defs["Notice Overview"] = { type: "notice-overview", note: "Every notice at a glance: who gets it, what is off and what has been changed." };
  help["Notice Overview"] = "All 33 notices in one table: what is on, what is off, what has been customised and who gets each one. Open any row to change it.";
  cats.push({ title: "Notice Types", hint: "Who is told, for every kind of notice", color: "#0e9f6e", tint: "#e0f7ee", items: ["Notice Overview"].concat(NOTICES.map(function (n) { return n.title; })) });
})();
