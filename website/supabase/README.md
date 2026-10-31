# VEYORA database (Supabase)

Source of truth for the schema and RLS rules. Apply `migrations/*.sql` in order via the Supabase SQL editor.

**Full catalogue for Claude (tables, RPCs, RLS, buckets, settings keys):** see **`DATABASE_HANDOFF.md`**.  
**Ownership:** Claude = database; Cursor = UI/app (`../CLAUDE.md`).

Model: multi-tenant. Many companies share one project; access is scoped by `company_members` and enforced with RLS.
Never put the service_role key in the front-end; only the project URL and anon key go in `config.js`.

## Migrations (apply in order)
- `0001_init.sql` — tables, RLS, logo bucket
- `0002_creator_can_read_company.sql` — creators can read their company during INSERT ... RETURNING
- `0003_logo_select_policy.sql` — storage select policy so logo upsert works
- `0004_company_settings.sql` — profile/settings columns on companies
- `0005_staff_invites.sql` — staff invites, suspension, per-company profile visibility
- `0006_platform_owner.sql` — platform admins, company approval/suspension, audit log
- `0007_settings_store.sql` — per-item settings RPC, company audit log, platform config
- `0008_organization.sql` — departments, job titles, staff org fields, employee ID generator
- `0009_custom_roles.sql` — role names on members and invites, so a custom role can be assigned
- `0010_subscriptions.sql` — plans and prices, overall and per-company trials, lifetime code, renew overlay
- `0011_subscription_hardening.sql` — blocks direct edits of subscription fields, random lifetime code, redeem rate limit
- `0012_platform_owner_access.sql` — platform owner can open and edit any company (company switcher)
- `0013_hr_crew.sql` — duty status, vessel assignment, certifications, leave requests and approval
- `0014_hr_settings.sql` — designations (crew groups), HR edits HR settings, leave workflow + crew assignment rules enforced
- `0015_hr_assign_designation.sql` — HR can assign a designation from the HR page
- `0016_approvers.sql` — named leave approvers (routing rules, fallback, manager), approvers can see and decide routed requests
- `0017_duty_roster.sql` — duty roster entries, set_roster() with leave/certificate/lock rules, roster editors, renewal-aware expired-certificate check
- `0018_agreements.sql` — agreement templates (designed or Word .docx), agreements with auto numbering and Draft/Sent/Signed status, private `agreements` file bucket, HR may edit 16_ settings
- `0019_hr_notifications.sql` — in-app notifications, certificate and leave alerts, scan_hr_notifications()
- `0020_roster_validation.sql` — qualification/rest/hours enforced on set_roster(), roster periods (draft/published/amended/locked), publish coverage check
- `0021_attendance.sql` — attendance records, clock in/out, corrections, CSV import
- `0022_staff_documents.sql` — employee files, private `staff-documents` bucket, version history, document expiry alerts
- `0023_hr_foundation.sql` — employee status (Active/Suspended/Former) and contract dates, certificate issuer/number, employee activity history, crew_check()/crew_availability(), HR may edit organization fields
- `0024_member_private.sql` — phone, emergency contact and status reason in `member_private` (HR and the person only)
- `0026_timesheets.sql` — weekly timesheets (scheduled vs actual hours, exceptions), HR approval locks the week, candidate overtime from approved weeks only (not paid yet)
- `0027_payroll.sql` — pay details per person, payroll runs (draft → approved → paid) from approved timesheets, payslips for staff, payroll approvers, payroll settings in HR
- `0028_allowance_rules.sql` — allowance rule engine: who it is for, conditions (all/any), tiered amounts, per day/shift/hour/overtime hour or % of basic, cut per absence, minimum and cap; pay runs and preview_allowances() use it
- `0029_allowance_preview_all.sql` — preview_allowances_all(): what rules would pay everyone on payroll for a period (rule builder impact)
- `0030_it_department.sql` — IT role, approved networks (IP/CIDR) and device registration enforced on clock-in, punch_check() logging and IT alerts, IT asset register, support tickets with replies, IT activity log; IT may edit 13_/14_/17_ settings
- `0031_maintenance.sql` — vessels, components and engine hours, preventive schedules (days/hours) with reminders, numbered work orders with approval, defects and breakdowns, inspection checklists that raise defects, vessel availability and return to service (blocks crew assignment), private `maintenance` file bucket, maintenance activity log; maintenance staff may edit 10_ settings
- `0032_spare_parts_purchasing.sql` — spare parts catalogue, stock per store location and stock movements, parts issued to and returned from work orders (parts cost calculated), low-stock alerts, suppliers, purchase requests with approval, purchase orders with delivery into stock and supplier invoice
- `0033_it_settings.sql` — ticket answer times and alert toggles from IT Settings, new-device alert toggle, scan_it_assets() warranty/licence reminders
- `0034_maintenance_costs_planning.sql` — contractor cost, estimates and planned dates on work orders, maintenance budgets and budget alerts, contractor profiles and technician skills, warranty claims and reminders, component life history (retire/dispose), vessel status history for downtime/availability, maint_report() with every maintenance report, planning calendar with clash checks (plan_work_order, maint_calendar)
- `0035_fleet_schedules.sql` — vessel capacity, route, standby and meta; routes, repeating schedule templates, trips with captain and crew (no double-booking of vessels or people, no trips over planned maintenance and vice versa), timetable feed with summary, generate/copy/import trips, trip status with delay/cancel notices; `meta jsonb` on every new table and Operations may edit 3_/4_/5_/6_ settings so new fields need no SQL
- `0036_local_times.sql` — trip and maintenance-planning messages show company local time
- `0037_operations_dispatch.sql` — Operations dispatch board: trip statuses from Operations Settings, trip numbers (TR-…), dispatch clearance with the Dispatch Rules, dispatch queue tasks, incidents & advisories (any member can report), trip history, auto-delay/auto-arrive (scan_operations), ops_board() feed
- `0038_bookings_passengers.sql` — passenger registry, bookings and booking passengers (manual, walk-up, customer page, API), seat counts, capacity / cut-off / required-information rules, cancellations and refunds, check-in and boarding, trip manifest
- `0039_operations_automation.sql` — runs every minute with pg_cron (job veyora_ops_tick): generates trips from templates, assigns captain and crew from the duty roster, boarding / departed / arrived by the clock (or Delayed with the reason), passengers boarded at departure
- `0040_company_api.sql` — per-company API keys (public / secret, hashed, origins, rate limit) and api_* endpoints; see COMPANY_API.md
- `0041_manual_delay_only.sql` — ops auto never sets Delayed; Delay is manual only
- `0042_roster_allow_absent.sql` — attendance Absent no longer blocks set_roster working shifts
- `0043_roster_documents_soft.sql` — expired certificates / missing qualifications no longer block set_roster by default (warnings only; 8_crew_assignment_rules.expired/.qualified default false and set false on existing companies)
- `0044_vessel_crew_mix.sql` — crew mix per vessel (`vessels.meta.crew_mix`, `set_vessel_crew_mix`), `member_fits_role`, `pick_crew_role`; `auto_assign_crew` fills trips by role from the roster and takes auto-placed people off when the roster changes; `crew_check` certificate rules default off
- `0045_manual_delay_hold.sql` — hand-delayed trips are never auto-departed; crew fill includes held/delayed trips; old automatic delays reset (applied together with 0041)
- `0046_finance.sql` — finance ledger (fills itself from bookings, refunds, invoices, payroll, maintenance), invoices, finance_summary
- `0047_reports.sql` — report runs/defs/schedules, private `reports` bucket, report_data / run_report / finish_report_run / reports_overview
- `0048_trip_seats_follow_vessel.sql` — trip seats follow the assigned vessel; vessel seat changes update open trips; refuses moving a trip onto a vessel too small for its bookings
- `0049_followme_fetch.sql` — FollowMe proxy: hidden per-vessel links, one outside call per company per minute, 60 s cache with stale fallback, timeout and size cap
- `0049_followme_fetch.sql` — server proxy `followme_fetch(p_vessel)` + `followme_cache` (http extension); Operations Tracking map (FollowMe has no CORS)
- `0050_employee_invite_profile.sql` … `0054_document_templates.sql` — see the files
- `0055_set_staff_name.sql`, `0056_salary_bank.sql`, `0057_invite_allowances.sql` — Cursor, 26 Oct (HR staff name, salary bank, invite allowances). On 27 Oct these were only in FileKeeper’s trash; restore them here and confirm they are applied
- `0058_harbour_arrival_detection.sql` — harbour registry (islands, harbours with circle/polygon geofences), route/trip harbour ids, raw GPS fixes, arrival engine (validate → geofence → dwell/fix-count confirmation), one audited arrival event per trip, FollowMe polled server-side every minute, GPS-tracked trips no longer arrived by the clock. Guide: `ARRIVAL_DETECTION.md`; tests: `tests/test_arrival_detection.py`
- `0059_arrival_lab.sql` — Arrival Lab for the platform owner: `arrival_simulate` (run a track through the live algorithm with what-if rules, read-only), `arrival_lab_trips` / `arrival_lab_trip_track` (replay stored fixes). Page: `arrival-lab.html`
- `0060_harbour_learning.sql` — Harbour Autopilot: learns harbours from where vessels stop at the start/end of trips, links routes automatically (GPS share or exact name), logs every change with undo; FollowMe also polled for learning; pg_cron job `veyora_harbour_learn` every 10 min
- `0061_shift_swaps.sql` — shift swaps between colleagues: request → colleague accepts → optional approver (HR rule `8_shift_swap_rules.hod`) → roster swapped via `roster_apply` (`set_roster` unchanged for callers); tests: `tests/test_shift_swaps.py`
- `0062_swap_designation.sql` — shift swap rule `8_shift_swap_rules.scope` (Anyone / Same designation / Same crew group); colleague picker filtered, request enforced
- `0063_swap_default_designation.sql` — shift swap `scope` defaults to Same designation
- `0064_ops_checkins.sql` — Operations check-in on a vessel (staff activity); apps start in look-up mode until staff check in; website "Recent check-ins" list; optional `enforce` rule; tests: `tests/test_ops_checkin.py`
- `0065_attendance_breaks.sql` — Break in / Break out during a shift (`attendance_breaks`, `break_punch`, `my_break_state`); switched on in HR Settings → Attendance Rules (`breaks`, `break_minutes`); website Attendance register; tests: `tests/test_attendance_breaks.py`
- `0066_phone_positions.sql` — phones checked in to a vessel share its position (`share_vessel_position`) and Operations reads the latest position per vessel (`vessel_live_positions`) for the Live Vessel Map; tests: `tests/test_phone_positions.py`
- `0067_my_approvals.sql` — `my_approvals(p_company)`: one list of leave, shift swaps and attendance corrections waiting for the signed-in person, plus their last 30 days of decisions (apps' Approvals tab); decisions use `decide_leave`, `decide_shift_swap`, `decide_attendance_correction`; tests: `tests/test_my_approvals.py`
- `0068_leave_self_service.sql` — leave for yourself in the apps: `my_leave_overview` (balances per type, your requests), `request_leave` (same rules as the website form, now enforced in the database), `cancel_leave`; tests: `tests/test_leave_self_service.py`
- `0069_leave_certificates.sql` — medical certificate rules per leave type (`cert` Not applicable / Optional / Required, `nocert` days a year without one, `nocertRun` longest stretch without one), enforced on every leave insert by trigger `leave_cert_rules`; `leave_requests.certificate`; `request_leave` takes `p_certificate`; `my_leave_overview` and `my_approvals` return the certificate data; tests: `tests/test_leave_certificates.py`
- `0070_leave_certificate_files.sql` — upload a medical certificate with a leave request: private bucket `leave-certificates` (10 MB, PDF or image, path `company_id/user_id/…`), `leave_requests.certificate_path` / `certificate_name`, per-type setting `certFile` (file required), `request_leave(..., p_certificate_path, p_certificate_name)`, `attach_leave_certificate`; owner, HR and the request's approvers can read the file; tests: `tests/test_leave_certificate_files.py`
- `0071_app_notifications.sql` — notifications in the apps: `my_notifications`, `mark_all_notifications_read`; new notices for new bookings, passengers added later, cancelled bookings and attendance corrections; push groundwork (`push_devices`, `register_push_device`, `push_outbox`); fixes `update_booking_passengers`, which failed on every call since 0038; edge function `functions/send-push` (needs your Apple and Firebase keys); tests: `tests/test_app_notifications.py`
- `0072_leave_status_trail.sql` — `leave_trail(p_id)`: the approval trail of one leave request (submitted, waiting for whom, or decided by whom, when, with note) for the apps' leave detail sheet.
- `0073_leave_routes_by_department.sql` — leave routing by department only: rewrites stored `Group:<crew group>` routes to `Dept:<uuid>` and re-creates `leave_approver_ids`. **Applied on `veyora` 29 Oct.**
- `0074_live_position_broadcast.sql` — trigger `vpos_broadcast` on `vessel_positions` (**applied on `veyora` 29 Oct**) sends each fix to the private Realtime channel `vessel-pos:<company id>` (event `position`); listening is limited to Operations by an RLS policy on `realtime.messages`.
- `0075_land_filter.sql` — land/sea check for vessel positions: table `land_masses` (island outlines), `fix_on_land()`, column `vessel_positions.on_land` set by trigger `vpos_land`, no broadcast of land fixes, and `vessel_live_positions` returns the last fix at sea (`held`, `live_age_s`). **Applied on `veyora` 29 Oct (migration and all 4 island files: 1310 islands, 28253 points).** Island data: load `supabase/seed/maldives_land_masses_1.sql` … `_4.sql` after the migration (OpenStreetMap coastline, © OpenStreetMap contributors, ODbL).
- `0076_trip_staff_notifications.sql` — booking notices (new booking, passenger added, cancelled) go to the trip's captain and `trip_crew` members (active only), Operations only when nobody is assigned. **Applied on `veyora` 29 Oct.**
- `0077_notification_recipients.sql` — booking notices by designation: company setting `3_booking_notice_recipients` (per notice: designations, rosteredOnly, tripStaff, operations) read by the new `trip_notice_audience(company, trip, kind)`; a person's assigned vessel limits them to that vessel's trips; Operations is the fallback. **Applied on `veyora` 29 Oct.**
- `0078_notice_types.sql` — one settings section per notification type: company setting `11_notice_types` (per kind: `enabled`, `keepDefault`, `teams`, `designations`, `rosteredOnly`) applied centrally inside `notify_user` / `notify_many`; converts the 0077 booking setting (`3_booking_notice_recipients`) and makes `trip_notice_audience` default-only. **Applied on `veyora` 29 Oct.**
- `0079_notice_safeguards.sql` — personal notices can never be switched off or lose the person they are about (`notice_required`, forced inside `notice_cfg`); notice settings are saved through `set_notice_type(company, kind, cfg)` (owners/admins only, known kinds, cleaned shape, audit entry `notice_changed`, null resets). **Applied on `veyora` 29 Oct.**
- `0080_quick_add_passengers.sql` — quick add of passengers: `quick_add_passengers(company, trip, name, phone, seats)` (one booking, one passenger per seat, lead named, others "<name> (guest N)") and `create_booking_quick(...)` for the website form; both need only a name and a phone number (ID not required) through a transaction-local flag read by `booking_create_core`; all other sources still follow Required Passenger Information. **Applied on `veyora` 30 Oct** (verified live with a rolled-back test add).
- `0081_accept_invite_fix.sql` — fixes `accept_invite` (ambiguous `settings` variable) so invite links add the person to the company. **Applied on `veyora` 29 Oct.**
- `0082_staff_photos.sql` — staff photos: `company_members.photo_path`, private bucket `staff-photos`, `set_staff_photo(company, user, path)` (HR or the person). **Applied on `veyora` 31 Oct.**

## Granting the platform owner (manual, one time)
After the owner has signed up, run in the SQL editor:
`insert into platform_admins (user_id) select id from auth.users where email = 'mohamed_yaish@icloud.com';`
Do this only after Confirm email is back on, otherwise anyone could sign up with that address first.

## Project
- Supabase project `veyora` (org trinkets-isle), URL/key in `../config.js`.
- Auth: "Confirm email" is OFF for development. Turn it on and set up SMTP before going live.
