/* Settings catalogue. "Platform Owner Settings" (10 items) is for VEYORA platform staff only and is not shown to company users. */
window.VEYORA_SETTINGS = [
 {
  "title": "Company Settings",
  "hint": "Profile, branding, regional",
  "color": "#1677e8",
  "tint": "#eaf3ff",
  "items": [
   "Company Profile",
   "Company Logo & Branding",
   "Company Registration Details",
   "Contact Information",
   "Office Address & Locations",
   "Company Status",
   "Regional Settings",
   "Default Currency",
   "Timezone & Date Format",
   "Language Preferences"
  ]
 },
 {
  "title": "Users & Access Control",
  "hint": "Control staff access by role",
  "color": "#2563eb",
  "tint": "#e8efff",
  "items": [
   "User Accounts",
   "Invite Staff",
   "Roles & Permissions",
   "Role Templates",
   "Department Access",
   "Module Access",
   "Record-Level Access",
   "Approval Permissions",
   "Account Activation & Suspension",
   "Login History"
  ]
 },
 {
  "title": "Organization",
  "hint": "Reporting and staff types — departments and staff IDs live under HR",
  "color": "#0d9488",
  "tint": "#e0f6f3",
  "items": [
   "Organization Structure",
   "Reporting Managers",
   "Staff Categories",
   "Employment Types"
  ]
 },
 {
  "title": "Operations Settings",
  "hint": "Trips, dispatch and incidents",
  "color": "#0ea5e9",
  "tint": "#e1f4fd",
  "items": [
   "Trip Statuses",
   "Trip Number Format",
   "Dispatch Rules",
   "Weather", // Cursor 2026-10-27: show/hide + country suffix; API key is in config.js
   "Operations Controls", // Cursor 2026-10-27: master toggles for dispatch safety (default on)
   "Departure & Arrival Rules",
   "Harbour Autopilot", // Claude 2026-10-28: harbours + route links learned from GPS (migration 0060)
   "Arrival Detection", // Claude 2026-10-28: GPS arrival rules (3_arrival_detection, migration 0058)
   "Vessel Map", // Claude 2026-10-29: land/sea rule for the Live Vessel Map (3_vessel_map, migration 0075)
   "Harbours & Geofences",
   "Route Harbours",
   "Trip Cancellation Rules",
   "Auto Crew Rules",
   "Delay Reasons",
   "Incident Categories",
   "Operational Approval Rules",
   "Passenger Capacity Rules",
   "Operations Check-in", // Claude 2026-10-28: 3_operations_check_in (migration 0064)
   "Seating", // Claude 2026-10-28: 3_seating.enabled; mobile apps show seat numbers only when on
   "Operational Notifications"
  ]
 },
 {
  "title": "Routes & Locations",
  "hint": "Manage ports, terminals and routes",
  "color": "#10b981",
  "tint": "#e2f8ee",
  "items": [
   "Island & Location Directory",
   "Atoll Management",
   "Terminals & Jetties",
   "Route Management Settings",
   "Route Naming Format",
   "Default Journey Durations",
   "Distance Units",
   "Boarding Locations",
   "Location Activation & Deactivation"
  ]
 },
 {
  "title": "Schedule Settings",
  "hint": "Types, templates, recurring trips, holidays",
  "color": "#8b5cf6",
  "tint": "#efe9fe",
  "items": [
   "Schedule Types",
   "Schedule Templates",
   "Recurring Trip Rules",
   "Default Departure Intervals",
   "Operating Days",
   "Holiday Calendar",
   "Seasonal Schedules",
   "Schedule Change Approvals",
   "Departure Cut-off Times",
   "Schedule Conflict Rules"
  ]
 },
 {
  "title": "Fleet Settings",
  "hint": "Vessel types, statuses and documents",
  "color": "#0369a1",
  "tint": "#e0f0fa",
  "items": [
   "Vessel Categories",
   "Vessel Type Definitions",
   "Vessel Registration Format",
   "Vessel Statuses",
   "Vessel Capacity Rules",
   "Engine Type Categories",
   "Vessel Document Types",
   "Vessel Availability Rules",
   "Vessel Assignment Restrictions",
   "Vessel Tracking"
  ]
 },
 {
  "title": "Passenger & Booking Settings",
  "hint": "Bookings, tickets and check-in",
  "color": "#db2777",
  "tint": "#fde8f2",
  "items": [
   "Booking Reference Format",
   "Passenger Categories",
   "Ticket Types",
   "Booking Statuses",
   "Check-in Rules",
   "Cancellation & Refund Rules",
   "Passenger Manifest Settings",
   "Booking Cut-off Times",
   "Passenger Notifications",
   "Required Passenger Information"
  ]
 },
 {
  "title": "HR & Crew Settings",
  "hint": "Staff IDs, shifts, leave and crew rules",
  "color": "#f59e0b",
  "tint": "#fef3dc",
  "items": [
   "Approvers & Responsibilities",
   "Employee ID Format",
   "Directory Tabs, Filters & Columns",
   "Employee Categories",
   "Employment Types",
   "Attendance Rules",
   "Shift Definitions",
   "Shift Swap Rules",
   "Duty Roster",
   "Roster Patterns",
   "Duty Hours",
   "Overtime Rules",
   "Payroll Configuration",
   "Allowance Rules",
   "Leave Types & Policies",
   "Leave Approval Workflow",
   "Crew Qualification Types",
   "License & Certificate Expiry Alerts",
   "Crew Assignment Rules",
   "HR Document Categories"
  ]
 },
 {
  "title": "Finance Settings",
  "hint": "Currency, tax and payments",
  "color": "#16a34a",
  "tint": "#e0f6e8",
  "items": [
   "Base Currency",
   "Supported Currencies",
   "Financial Periods",
   "Revenue Categories",
   "Expense Categories",
   "Category Defaults",
   "Payment Methods",
   "Finance Accounts",
   "Reconciliation Settings",
   "Invoice Number Format",
   "Receipt Number Format",
   "Document Branding",
   "Payment Terms",
   "Tax Configuration",
   "Tax Rates",
   "Financial Approval Limits",
   "Budget Categories",
   "Payroll Configuration",
   "Payroll Finance Posting",
   "Financial Report Preferences"
  ]
 },
 {
  "title": "Maintenance Settings",
  "hint": "Jobs, intervals and work orders",
  "color": "#ea580c",
  "tint": "#fdebdd",
  "items": [
   "Maintenance Categories",
   "Maintenance Job Types",
   "Service Interval Rules",
   "Preventive Maintenance Schedules",
   "Maintenance Reminder Rules",
   "Work Order Statuses",
   "Priority Levels",
   "Work Order Number Format",
   "Inspection Checklist Templates",
   "Defect Categories",
   "Maintenance Approval Rules",
   "Return to Service Rules",
   "Maintenance Permissions",
   "Spare Parts Categories",
   "Units of Measurement",
   "Labour Rates & Cost Categories",
   "Maintenance Document Requirements"
  ]
 },
 {
  "title": "Notification Settings",
  "hint": "Channels, alerts and templates",
  "color": "#6366f1",
  "tint": "#e9eafd",
  "items": [
   "Email Notifications",
   "In-App Notifications",
   "Push Notifications",
   "Trip Reminders",
   "Schedule Change Alerts",
   "Vessel Maintenance Alerts",
   "Certificate Expiry Alerts",
   "Leave Approval Notifications",
   "Financial Approval Alerts",
   "Notification Recipients",
   "Notification Templates"
  ]
 },
 {
  "title": "Approval Workflows",
  "hint": "Who approves what, and when",
  "color": "#7c3aed",
  "tint": "#f0e9fe",
  "items": [
   "Trip Cancellation Approval",
   "Schedule Change Approval",
   "Crew Assignment Approval",
   "Leave Approval",
   "Expense Approval",
   "Payment Approval",
   "Payroll Approval",
   "Maintenance Approval",
   "Approval Limits",
   "Escalation Rules",
   "Approval History"
  ]
 },
 {
  "title": "Security & Authentication",
  "hint": "Sessions, password and device rules",
  "color": "#0f766e",
  "tint": "#dff5f2",
  "items": [
   "Password Policy",
   "Two-Factor Authentication",
   "Single Sign-On",
   "Session Timeout",
   "Login Restrictions",
   "Failed Login Protection",
   "Active Sessions",
   "Trusted Devices",
   "API Access",
   "Security Event Logs"
  ]
 },
 {
  "title": "Integrations & Data Management",
  "hint": "Connected services and imports",
  "color": "#f97316",
  "tint": "#fdeedd",
  "items": [
   "Email Service Configuration",
   "SMS Provider Configuration",
   "Microsoft 365 Integration",
   "External API Connections",
   "Import Data",
   "Export Data",
   "Backup Configuration",
   "Data Retention Policy",
   "Document Storage Settings",
   "Data Import History",
   "Integration Logs"
  ]
 },
 {
  "title": "System Preferences & Administration",
  "hint": "Appearance, audit logs, billing",
  "color": "#475569",
  "tint": "#e8ecf2",
  "items": [
   "Appearance & Theme",
   "Light / Dark Mode",
   "Date & Time Formats",
   "Dashboard Preferences",
   "Table & List Preferences",
   "Default Landing Page",
   "Audit Logs",
   "System Activity History",
   "Custom Fields",
   "Numbering Sequences",
   "Archived Records",
   "System Maintenance",
   "Subscription & Billing",
   "Help & Support"
  ]
 },
 {
  "title": "Agreements & Documents",
  "hint": "Agreement types, numbering and PDFs",
  "color": "#0f766e",
  "tint": "#e3f6f3",
  "items": [
   "Agreement Categories",
   "Agreement Numbering",
   "Agreement PDF Layout",
   "Agreement Reminders"
  ]
 },
 {
  "title": "IT Settings",
  "hint": "Networks, devices, access, assets and support",
  "color": "#4f46e5",
  "tint": "#e7e8fd",
  "items": [
   "Access Controls",
   "Network & IP Restrictions",
   "Mobile Check-in & Check-out",
   "Device Management",
   "User & Role Management",
   "Authentication & Login Security",
   "Security & Audit Logs",
   "Module & Feature Management",
   "API & Integration Management",
   "Database & Backup Management",
   "System Monitoring & Maintenance",
   "Alerts & Notifications",
   "IT Asset Management",
   "Temporary Access & Approvals",
   "Network Diagnostics",
   "Data Access & Retention",
   "Configuration Management",
   "IT Support & Incident Management",
   "Email & System Services",
   "Security Policies"
  ]
 }
];
