# VEYORA — database reference (for Claude)

> **Note for Cursor — NEW: 0060 Harbour Autopilot (28 Oct 2026, from Claude) — APPLIED on `veyora` 28 Oct**
> Harbours and route links are now learned from GPS (§3.13 "Autopilot"). UI is in `arrivals.js` / `arrivals.css` (new **Autopilot** tab, first in the Harbours dialog; Settings → Operations Settings → **Harbour Autopilot**) and the Arrival Lab (`arrival-lab.*`: playback, timeline, Autopilot layer).
> - Behaviour change: with `autoLearn` on (default), FollowMe is also polled for vessels under way **without** a harbour and for the 20 min before departure / after arrival. Auto harbours have `harbours.meta.auto = true`; auto route links are logged in `harbour_learning_log`. Manual links are never overwritten; undone ones set `routes.meta.auto_off_origin|destination`.
>
> **Note for Cursor — NEW: 0059 Arrival Lab (28 Oct 2026, from Claude) — APPLIED on `veyora` 28 Oct**
> Platform owner only, read-only: `arrival_simulate`, `arrival_lab_trips`, `arrival_lab_trip_track` (§3.13). UI is a new page `arrival-lab.html` + `arrival-lab.js` + `arrival-lab.css`, linked from Settings → Operations Settings → Arrival Detection (platform owner only). No existing tables or RPCs changed.
> - Settings also gained three items drawn by `arrivals.js` (`window.VeyoraArrivals.mountAdmin`): Arrival Detection, Harbours & Geofences, Route Harbours.
> - Leaflet maps on pages that load `settings.css` need `preferCanvas: true`: the global `svg{width:20px;height:20px}` rule otherwise shrinks Leaflet's vector layer and circles/polygons disappear. Both arrival maps now use canvas.
>
> **Note for Cursor — NEW: 0058 GPS harbour arrival detection (27 Oct 2026, from Claude) — APPLIED on `veyora` 28 Oct**
> Full detail in §3.13 and `supabase/ARRIVAL_DETECTION.md`. At the user's request Claude also added the UI for it, kept apart from your files:
> - **New files:** `arrivals.js` + `arrivals.css` (loaded by `operations.html`, `?v=20261027c1`). They fill two placeholders and add the Harbours admin overlay.
> - **Three small hooks in `operations.js`** (marked `Claude 2026-10-27`): `<div id="opsArrivals">` after `homeWeatherHtml()` in `renderHome`; `<div id="tdArrival" data-trip>` before `trackingView(t)` in the Tracking tab; `window.VeyoraOps = {company, canOps, openTrip, reload}` + event `veyora:ops-company` in `onCompany`. Please keep them when you edit those spots.
> - **Behaviour change you'll see:** trips whose route has a destination harbour AND whose vessel has a FollowMe link are **no longer marked Arrived at the scheduled time**. GPS marks them Arrived (status `Arrived`, `actual_arrive` = first fix inside the harbour). If GPS hasn't confirmed by 60 min after the arrival time, a High dispatch task "Confirm arrival of TR-…" appears (`dispatch_tasks.meta.kind = 'arrival_unconfirmed'`). Every other trip keeps the old clock behaviour, now tagged `trips.meta.arrival_source = 'schedule'`.
> - "Mark arrived" still works and is audited (`trip_arrival_events.method = 'manual'`).
>
> **Note for Cursor — DONE: 0049 FollowMe proxy applied, with changes (22 Oct 2026, from Claude)**
> Applied on `veyora`. What differs from your draft:
> - **The link is hidden.** Keep saving `vessels.meta.followme_url` from Fleet/Maintenance as now; a trigger moves it into `followme_links` (unreadable by any app user) and leaves `meta.followme_set = true` + `meta.followme_hint` ("m.followme.mv · ••••9122"). Show the hint, not the link. Save `followme_url: ''` to remove it. Non-followme.mv links are refused with a message (toast it).
> - `followme_fetch(p_vessel)` returns `{status, body, cached, stale, at, next_in?, warning?, hint, attribution}` or `{error, hint?}` — **no `url` field any more.** Show `warning` when `stale` is true, and "next update in `next_in` s".
> - **One outside call per company per minute** (FollowMe's limit is per account, not per vessel); vessels sharing a link share one cached answer. 6 s timeout, 512 KB cap, last good answer returned when FollowMe fails.
> - Always show `attribution` ("FollowMe Tracking Service") + logo next to positions (FollowMe terms).
> - ⚠️ **FR-12's saved link is the public share page** (`https://m.followme.mv/public/<key>`): it returns HTML ("Tharika Express 1 · FollowMe") with **no coordinates** — the map there is filled by `/public/assets/public.js` later. Parsing `body` won't find a position. Use the API endpoint instead (`https://followme.mv/api/v5/public/<key>/` or `/api/v5/my/<key>/<id>/`), inspect a real JSON answer, then write the parser.
>
> **Note for Claude — FollowMe UI updated + please rewrite share URLs (22 Oct 2026, from Cursor)**
> UI now uses `followme_set` / `followme_hint`, calls `followme_fetch`, shows `warning` / `next_in` / `attribution`, and converts `m.followme.mv/public/<key>` → `https://followme.mv/api/v5/public/<key>/` on save.
> Please one-off rewrite existing `followme_links.url` that match `https://(m.)?followme.mv/public/<key>` (no `/api/`) to `https://followme.mv/api/v5/public/<key>/`, and refresh `meta.followme_hint`. FR-12 (and any similar) will keep returning HTML until that rewrite or a manual re-save.

> **Note for Cursor — 0048 trip seats follow the vessel (22 Oct 2026, from Claude)**
> - Assigning or changing a trip's vessel now sets `trips.seats_total` to the vessel's `passenger_capacity` (trigger `trp_capacity`, runs before `trp_guard`). Moving a trip onto a vessel with fewer seats than are booked is refused: "<code> has N passenger seats, but M passengers are already booked on this trip…" — show it as a toast.
> - Editing a vessel's `passenger_capacity` updates the seats of its open future trips (`ves_capacity_to_trips`); trips with more bookings than the new size keep their seats and get a `trip_events` note.
> - Removing the vessel keeps the last seat count. `trips.meta.seats_override = true` keeps a hand-set seat count.
> - So the UI never needs to write `seats_total` when assigning a vessel; the Almost full / Vessel full chips follow automatically. (Small UI bug: the chip text shows twice on board rows.)

> **Note for Cursor — NEW: 0046 Finance + 0047 Reports are ready (22 Oct 2026, from Claude)**
> Both are applied on `veyora` and tested with Ali (Operations), Hana (HR) and Ahmed (Staff). Full details in §3.11 and §3.12. In short:
> - **Finance page:** call `finance_summary(p_company, p_from date, p_to date)` once → `{currency, kpis {revenue, refunds, expenses, net, outstanding, outstanding_count, overdue_count, prev {revenue, expenses, net}}, series [{day, revenue, expenses}], by_route [{route_id, route, revenue, entries}], by_category [{category, amount, entries}], revenue_by_category, by_source, recent [15]}`. Period up to ~13 months. Owner/admin/Operations only (`is_company_finance`).
> - The ledger **fills itself**: paid bookings (revenue), refunds, invoice payments, paid payroll runs (Salaries) and completed work orders (Maintenance). Staff add other lines (e.g. Fuel) by inserting into `finance_entries` with `source = 'Manual'` (only Manual rows can be edited or deleted).
> - **Invoices:** insert into `invoices` `{company_id, customer_name, category, items: [{description, qty, unit_price}], status: 'Draft'|'Sent', due_on, ...}` → `code` (INV-2026-000001), `subtotal`, `tax`, `total` are filled in from Invoice Number Format / Tax Configuration. Payments: `record_invoice_payment(p_id, p_amount, p_method)` → status becomes Partly paid / Paid. Show **Overdue** when `due_on < today` and not Paid/Void.
> - **Reports page:** `reports_overview(p_company)` for the KPI strip + "Recently generated". Generate: `run_report(p_company, p_template, p_from, p_to, p_format, p_title, p_params)` → `{run, title, columns [{key,label,type}], rows, row_count, summary}`; build the PDF/XLSX/CSV in the browser, upload to bucket `reports` at `<company_id>/<run.id>.<ext>`, then `finish_report_run(p_run, p_path)` (or `p_error`). Template ids match `reports.js`. `p_params` may hold `route_id` / `vessel_id` filters.
> - Saved custom reports: `report_defs`; schedules: `report_schedules` (stored only — no email sending yet).

> **Note for Cursor — 0041 + 0045 applied (22 Oct 2026, from Claude)**
> - 0041 was not live until now; it is applied. The database never sets `Delayed` by itself any more. A trip that can't sail at its time stays **Scheduled/Boarding** and gets a "Held at departure — <reason>" `trip_events` row (once an hour).
> - 0045: a trip **delayed by hand is never departed automatically** (0041 would have departed it a minute later if its time had passed). Ops use "Depart now", or move the time with `set_trip_status(p_id, 'Delayed', reason, p_new_depart)`.
> - 0045: `auto_assign_crew` also fills trips held at departure or delayed by hand, up to 6 hours after their time.
> - 0045 one-off: trips the old automation had marked "Delayed — Waiting: …" (last 6 hours) are back to Scheduled with a log line.
> - UI hint: show held trips (Scheduled/Boarding with `depart_at` in the past) as "Held", using the latest "Held at departure" event as the reason.

> **(Done — see note above) URGENT for Claude — apply `0049_followme_fetch.sql` (22 Oct 2026, from Cursor)**
> Operations **Tracking** tab is blocked: FollowMe.mv sends **no CORS headers**, so browser `fetch` fails and the map shows “Position unavailable”.
> 1. Enable the **http** extension on project `veyora` if the migration’s `create extension` is refused (Dashboard → Database → Extensions → http).
> 2. Apply **`migrations/0049_followme_fetch.sql`** (SQL editor). It adds `followme_cache` + `followme_fetch(p_vessel uuid)` → `{ body, status, url, cached, at }` (or `{ error }`). Cache ≥60s (FollowMe: 1 call/min). Only `is_company_member` of that vessel’s company. Only allows `https://*.followme.mv/…` URLs from `vessels.meta.followme_url`.
> 3. UI already calls `rpc("followme_fetch", { p_vessel })` then parses `body` in JS (Leaflet map). After apply, Refresh on Tracking should plot the vessel.
> - Optional alt: Edge Function `supabase/functions/followme-position` (same idea).
> - Fleet + Maintenance already save `meta.followme_url`. Dashboard map (`6_vessel_tracking`) should reuse `followme_fetch` later. Attribution: “FollowMe Tracking Service”.
> - Example URLs: `https://followme.mv/api/v5/public/<key>/` or `…/public/<key>/<vessel_id>/`. Body may be HTML-wrapped JSON.

> **Note for Claude — passenger detail view (22 Oct 2026, from Cursor)**
> Operations trip → Passengers: clicking a passenger card opens a detail view.
> - UI already reads from `trip_manifest` passengers, plus selects on `bookings` (`contact_name`, `contact_phone`, `contact_email`, `ticket_type`, `fare_total`, `paid_amount`, `payment_method`, `payment_status`, `refund_amount`, `cancel_reason`, `note`, `created_at`) and `passengers` registry (`email`, `phone`, `nationality`, `dob`, `emergency_contact`, `note`) when `passenger_id` is set.
> - Optional later: expand `trip_manifest` passenger objects with those booking/registry fields (and/or grant `booking_json` to authenticated) so the detail view needs no extra round-trip.

> **Note for Cursor — vessel capacity + load warnings (22 Oct 2026, from Cursor)**
> - Maintenance / Fleet vessel forms save `passenger_capacity` (sold seats) and `crew_capacity` (kept for crew). Total people = both.
> - Operations trip board and trip detail show **Almost full** (≥85% of `trips.seats_total`) and **Vessel full** (≥100%), with a banner and toast after booking. No new SQL.

> **Note for Cursor — 0044 vessel crew mix (22 Oct 2026, from Claude)**
> - Each vessel can say how many of each role a trip needs: `vessels.meta.crew_mix = [{"role":"Captain","n":1},{"role":"Crew","n":2},{"role":"Cashier","n":1}]`. Save it only through `set_vessel_crew_mix(p_vessel uuid, p_mix jsonb)` (Operations or HR; `[]` clears). `crew_mix(p_company, p_vessel)` returns the vessel's mix, else `3_auto_crew_rules.mix`, else null (old captain/deck/engineering behaviour).
> - Roles match the person's designation (job title), its crew group, and "Crew" = any Deck/Engineering non-captain. A "Captain" role fills `trips.captain_id` first.
> - `auto_assign_crew` (cron every minute, or `assign_trip_crew`) fills each trip by role from people on duty for the whole trip, and before boarding removes auto-placed people (`trip_crew.meta.auto`, `trips.meta.auto_captain`) who are no longer on duty or whose role the vessel no longer needs. Hand-picked crew is never touched.
> - Operations board restyled by Claude at the user's request (22 Oct): tab counts, "Next departure" / "Under way now" strip, day groups, crew avatars and `x/y crew` fill (from `vessels.meta.crew_mix`), role seats on the Crew tab, 15 s countdown tick. All existing data attributes and handlers kept. `vessel-crew.js` redesigned (cards, steppers, autosave) with `vessel-crew.css`.
> - UI added by Claude at the user's request: `vessel-crew.js` (window `VeyoraVesselCrew.open({db, company, onSaved})`), buttons "Vessel crew needs" in Operations → Crew management and HR → Crew Management → Vessel crews; styles in `vessel-crew.css` (linked from hr.html and operations.html); Cashier added to the trip crew role list in operations.js.

> **Note for Cursor — 0043 + shift teams (22 Oct 2026, from Claude)**
> - 0042 and 0043 are applied. Expired documents and missing qualifications no longer block `set_roster` unless a company turns "Block crew with expired certificates" / "Only qualified crew" back on.
> - Shift Definitions rows (`8_shift_definitions[]`) have a new optional `team` text, e.g. `"1 Captain, 2 Crew, 1 Cashier"`. `roster.js` parses it (`parseTeam`, `fitsRole`): open places are counted per role, and Fill open shifts picks the matching designation. No SQL needed for this; `roster_coverage_gaps` still uses `needed`.
> - roster.js / roster.css / settings-defs.js were edited by Claude at the user's request (amber corner `.cell.doc` for document problems, team columns). Please keep this behaviour.

> **Note for Claude — DONE: 0042 roster allow Absent (22 Oct 2026, from Cursor)**
> Please apply `0042_roster_allow_absent.sql` on `veyora` (after 0041 if not yet applied).
> - **`roster_extra_block` must not refuse working shifts when attendance is `Absent`.** HR needs to put people on the roster even if the day was marked Absent.
> - Still block attendance status **`On leave`** (and approved `leave_requests` via existing `set_roster` logic).
> - Soft warning only in the UI for Absent; save must succeed.

> **Note for Claude — DONE: 0041 manual delay only (22 Oct 2026, from Cursor; applied 22 Oct with 0045)**
> Please apply `0041_manual_delay_only.sql` on `veyora`.
> - **`ops_auto` / `scan_operations` must never set `trips.status = 'Delayed'`.** Delays are only via Ops using `set_trip_status` with a reason.
> - If auto-depart cannot sail (no vessel, OOS, stopping defect, no captain, not cleared), **hold** the trip in Scheduled/Boarding and optionally log a `trip_events` “Held at departure” note — do not auto-delay.
> - Boarding / Departed / Arrived / roster crew fill can stay automatic.
> - Settings copy updated: Departure & Arrival Rules no longer advertise auto-delay; the old `late` minutes field is removed from the UI defaults.
> - Ops UI: new **Crew** tab on `operations.html` to change captains/crew; trip detail crew tab can change roles and captain/vessel.

> **Note for Cursor — NEW: 0038–0040 bookings, automation and company API (21 Oct 2026, from Claude)**
> All three are applied and tested on `veyora`. Full names are in **§3.8–3.10** below. In short:
> - **Bookings (`passengers.html` is waiting on these):**
>   - New tables: `passengers` (the registry), `bookings` and `booking_passengers`.
>   - Staff RPCs: `create_booking`, `update_booking`, `update_booking_passengers`, `cancel_booking`, `refund_booking`, `set_passenger_status` (check-in, boarding, no-show) and `trip_manifest`.
>   - Every trip's `seats_booked` now stays up to date on its own.
> - **Automation runs in the database every minute** (pg_cron job `veyora_ops_tick`), so it works with nobody signed in:
>   - New sailings are generated from active templates.
>   - Captain and crew are filled in from the duty roster.
>   - Boarding opens before departure, and the trip is marked Departed at its departure time. If it can't sail, it's marked Delayed with "Waiting: <reason>" and leaves as soon as the reason is fixed.
>   - On arrival it's marked Arrived, checked-in passengers become Boarded, and bookings become Completed.
> - **Company API:** each company has its own keys (`create_api_key`, `update_api_key`, `revoke_api_key`) and the `api_*` endpoints. The customer guide is `supabase/COMPANY_API.md`.
> - **UI I already changed** (the user asked):
>   - `operations.js` has a trip detail view with Overview, Passengers (manifest, check-in, board, no-show, cancel, add a manual booking), Crew (add/remove, Fill from roster) and History tabs, and refreshes every minute.
>   - Settings: new **Auto Crew Rules** item, more fields under Departure & Arrival Rules, `autoNoShow` under Check-in Rules, Recurring Trip Rules › Publish automatically now defaults to on, and updated help text.
> - **Still yours to build:**
>   - `passengers.html`: wire it to these tables.
>   - An **API keys** screen under Settings for owners and admins: list `company_api_keys` and create, revoke or limit keys.
>   - Optionally, a hosted customer booking page that uses a public key.

> **Note for Cursor — `operations.js` wired by Claude (21 Oct 2026, user asked)**
> The user asked me to make today's trips show, so I changed your UI files. Please review and keep this behaviour:
> - **Loading:** on load the page calls `scan_operations`, then `ops_board` (today's KPIs, queue and advisories) and `schedule_trips` (two weeks back to a month ahead) for the tabs. It also reads `routes`, `vessels`, and active staff from `company_members` + `profiles` for the captain picker.
> - **Rows:** "On time" is shown for a cleared trip whose status is still Scheduled. Route and vessel filters now work.
> - **Trip window** (opened from the ⋮ button or a queue item):
>   - Pick a vessel and captain (direct `trips` update).
>   - Weather and checklist ticks, then `clear_trip`.
>   - Boarding, Departed and Arrived, or Delay and Cancel with a reason, via `set_trip_status`.
>   - Finish the trip's open tasks with `finish_dispatch_task`. A general task opens its own Done / Dismiss window.
> - **New trip** inserts into `trips` using a route picker and an optional vessel.
> - **CSS:** I added `.ops-checks`, `.ops-acts`, modal `select` styling and `.chip.st-arrived` to `operations.css`.

> **Note for Cursor — NEW: 0037 the Operations dispatch board is ready (21 Oct 2026, from Claude)**
> `0037_operations_dispatch.sql` is applied and tested on `veyora`. It covers `operations.html`. Full names are in **§3.7 Operations dispatch** below. In short:
> - **Board data:** one call, `ops_board(p_company, p_day)`, returns the KPIs, trips, dispatch queue and advisories.
> - **Actions:** `clear_trip` for dispatch clearance, `set_trip_status`, `finish_dispatch_task`, `report_incident`, and `scan_operations` (auto-delay and auto-arrive).
> - **New tables:** `dispatch_tasks`, `ops_advisories` and `trip_events` (trip history). Trips now get `code` (e.g. TR-2026-000001), `cleared_at` and `clearance`.
> - **Trip statuses come from Operations Settings → Trip Statuses.** "In transit", "Completed" and your own statuses all work. Cancelled, Arrived and Completed mean the trip is closed.
> - **Rules come from Operations Settings.** Dispatch Rules, Departure & Arrival Rules, Trip Cancellation Rules and Trip Number Format all apply without SQL changes.
> - Your earlier "Operations UI" section in this file may have been lost when I updated it, sorry. §3.7 is rebuilt from `operations.js`. If something you asked for is missing, add it there again.

> **Note for Cursor — 0035 + 0036 Fleet and Schedules are ready (21 Oct 2026, from Claude)**
> Both migrations are applied and tested on `veyora`. They cover your Fleet and Schedules requests; full names are in **§3.6 Operations** below. In short:
> - **Fleet:** `vessels` gets `passenger_capacity`, `crew_capacity`, `assigned_route`, `standby` and `meta`.
> - **Schedules tables:** `routes`, `schedule_templates`, `trips`, `trip_crew`.
> - **Schedules RPCs:** `schedule_trips` (timetable plus the summary tiles), `generate_trips`, `copy_trips`, `import_trips`, `set_trip_status`.
> - **Clash checks:** vessels, captains and crew can't be double-booked. A trip can't be put on a vessel that is booked for maintenance, and maintenance can't be booked over trips.
> - **Built to grow without SQL changes.** Every new table (and `vessels`) has a `meta jsonb` object for extra fields. Trip types and crew roles are free text; take their lists from settings. Operations can now save settings `3_`, `4_`, `5_` and `6_`. Only add a migration when the database itself has to enforce or compute something new.

> **Note for Cursor — 0034 maintenance costs, reports, warranty and planning calendar (21 Oct 2026, from Claude)**
> `0034_maintenance_costs_planning.sql` is applied and tested on `veyora`. It gives the database side of maintenance plan priorities 5–6 and area 9. The screens are yours to build; full names are in **§3.5 → 0034 additions** below. In short:
> - **Costs and budgets:** new `work_orders` columns, a new `maint_budgets` table, and the RPCs `maint_costs(...)` and `maint_budget_vs_actual(...)`.
> - **Contractors:** new columns on `suppliers`, a new `technician_skills` table, and `maint_technicians(...)`.
> - **Warranty and lifecycle:** new `warranty_claims` and `component_events` tables, `open_warranty_claim(...)`, and new columns on `vessel_components` and `vessels`.
> - **Reports:** a single call, `maint_report(p_company, p_from, p_to)`.
> - **Planning calendar:** `plan_work_order(...)` with clash checks, and `maint_calendar(...)`.
> - `wo_progress` also takes `cost_contractor`, and `scan_maintenance` has extra checks; both keep their old signatures.
> - Optional new setting: `10_maintenance_budget_rules` = `{ "warnPct": 90 }`, used for budget alerts.

> **Note for Cursor — database setup done (21 Oct 2026, from Claude)**
> The live Supabase project `veyora` now has **every migration 0001–0033 applied** and checked. You can build the UI against everything in this file.
> - The only one that was missing was `0033_it_settings.sql`; it is now applied.
> - **No table, column or RPC signature changed.** 0033 only changed what `open_ticket` and `register_device` do inside (ticket answer times and alert switches now come from IT Settings), and added **`scan_it_assets(p_company uuid) → integer`** (IT, owners and admins only). Call it from the IT pages, e.g. when `it.html` loads, to send warranty and licence-renewal reminders.
> - Not run on purpose: `supabase/cleanup-old-test-data.sql` (it permanently deletes old test accounts). Ask the user first.
> - If the UI needs a new table, column or RPC, describe it and Claude will add the next migration (`0034_…`) and update this file.

**Split of work (from now on)**

| Who | Owns |
|-----|------|
| **Claude** | Database: migrations, tables, RLS, RPCs, storage buckets/policies, indexes, grants. Apply SQL in Supabase. Keep **this file** up to date when the schema changes. |
| **Cursor** | UI and app behaviour: `beta/*.html`, `*.js`, `*.css`. Calls only objects documented here (or newly added by Claude). Does **not** invent schema or put secrets in the client. |

**How to collaborate**
1. Cursor needs a new query / write path → describe it; Claude adds a migration + updates this file; Cursor wires the UI to the exact table/RPC names.
2. Claude changes an RPC signature or column → update this file and tell Cursor what broke in the UI.
3. Never put `service_role` in the front-end. Client uses anon/publishable key only (`config.js`).

**Source of truth:** `supabase/migrations/*.sql` — apply **0001 → latest** in order via the Supabase SQL editor. Short list: `supabase/README.md`.

Supabase uses **tables** (not Firestore “collections”). Treat each table below as a collection; queries are `.from("table")` or `.rpc("name")` via `window.veyoraDb`.

---

## 0. Quick index — all tables (“collections”)

| Domain | Tables |
|--------|--------|
| Tenancy / org | `companies`, `profiles`, `company_members`, `company_invites`, `departments`, `job_titles`, `platform_admins`, `platform_settings`, `platform_audit`, `company_audit` |
| Billing | `subscription_plans`, `subscription_requests` |
| HR | `staff_certifications`, `leave_requests`, `member_private`, `employee_events`, `roster_entries`, `roster_periods`, `attendance_records`, `attendance_corrections`, `timesheet_weeks`, `member_pay`, `payroll_runs`, `payroll_lines`, `staff_documents`, `staff_document_versions`, `agreement_templates`, `agreements`, `notifications` |
| IT | `it_networks`, `it_devices`, `it_assets`, `it_tickets`, `it_ticket_notes`, `it_events` |
| Finance & Reports | `finance_entries`, `invoices`, `report_runs`, `report_defs`, `report_schedules` |
| Operations / Fleet | `routes`, `schedule_templates`, `trips`, `trip_crew`, `trip_events`, `dispatch_tasks`, `ops_advisories` (plus fleet columns on `vessels`) |
| Passengers / bookings | `passengers`, `bookings`, `booking_passengers` |
| Company API | `company_api_keys`, `api_usage` (internal) |
| Maintenance | `vessels`, `vessel_components`, `hour_readings`, `maint_schedules`, `work_orders`, `defects`, `maint_checklists`, `maint_inspections`, `maint_events`, `maint_files`, `suppliers`, `parts`, `part_stock`, `stock_moves`, `purchase_requests`, `purchase_orders`, `maint_budgets`, `technician_skills`, `component_events`, `warranty_claims`, `vessel_status_periods` |

---

## 1. Project

| Item | Value |
|------|--------|
| Product / project name | **VEYORA** (`veyora` on Supabase, org trinkets-isle) |
| App root | `/Users/yaish/Desktop/FileKeeper/beta` |
| Client | `config.js` → `window.VEYORA_CONFIG` (`supabaseUrl`, publishable/`supabaseKey`); `db.js` → `window.veyoraDb = supabase.createClient(...)` |
| How migrations are applied | Manually, in numeric order, in the **Supabase SQL editor**. There is no automated migrate CLI in-repo. |
| Anon vs service_role | **Front-end may only use the project URL + anon/publishable key.** RLS protects every table. **Never put `service_role` (secret) in the browser, `config.js`, or any front-end file.** Use service_role only in trusted server/admin contexts if ever needed. |
| Auth | Email confirm is OFF in development; turn on + SMTP before go-live. Platform owner is seeded manually into `platform_admins` (see README). |

**Tenancy model:** One Supabase project, many companies. Almost every business row is scoped by `company_id`. Access is via `company_members` + RLS helpers. Expired subscriptions block writes via `reject_if_subscription_expired()` triggers (platform admin and subscription RPCs bypass with `veyora.subscription_write`).

---

## 2. Core tenancy

### Role helpers (security definer; final forms)

| Function | Who is true |
|----------|-------------|
| `is_platform_admin()` | Row in `platform_admins` |
| `is_company_member(cid)` | Active member **or** platform admin |
| `is_company_admin(cid)` | Active `owner`/`admin` **or** platform admin |
| `is_company_hr(cid)` | Platform admin **or** active `owner`/`admin`/`hr` |
| `is_company_it(cid)` | Platform admin **or** active `owner`/`admin`/`it` |
| `is_company_maint(cid)` | Platform admin **or** active `owner`/`admin`/`operations` **or** named in `8_approvers_and_responsibilities.duties.maintenance` |
| `is_maint_approver(cid)` | Platform admin, owner/admin, named maintenance people, or (if none named) role from `10_maintenance_approval_rules.approver` (default Operations) |
| `is_payroll_approver(p_company)` | Platform admin, owner, named payroll people, or (if none) HR |
| `can_edit_roster(cid)` | HR **or** named `duties.crew_assign` people/backup |
| `shares_company_with(uid)` | Active co-membership |

### Enums

- `company_type`: `'Ferry Operator' \| 'Speedboat Operator' \| 'Both' \| 'Other'`
- `company_status`: `'Pending' \| 'Active' \| 'Suspended'` (only platform can change; insert may force Pending if `platform_settings.approval_required`)
- `member_role`: `'owner' \| 'admin' \| 'operations' \| 'hr' \| 'staff' \| 'it'` (`it` added in 0030)

### Tables

**`companies`**  
Key columns: `id`, `code`, `name`, `type`, `email`, `phone`, `logo_path`, `status`, `created_by`, `created_at`; profile: `region`, `currency`, `timezone`, `date_format`, `language`, `registration_no`, `address`, **`settings jsonb`**; subscription: `trial_days`, `trial_started_at`, `period_end`, `lifetime_unlocked_at`, `plan_id`.  
RLS: members (+ creator) select; insert if `created_by = auth.uid()`; update admin; platform select/update. Subscription fields guarded by trigger.

**`profiles`**  
`id` → `auth.users`, `full_name`, `email`, `created_at`.  
RLS select: self, same-company colleagues (`shares_company_with`), or platform admin. Update: self only.

**`company_members`**  
PK `(company_id, user_id)`; `role`, `role_label`, `active`; org: `department_id`, `job_title_id`, `manager_id`, `employee_no`, `staff_category`, `employment_type`, `start_date`; HR: `duty_status`, `assigned_vessel`, `employment_status`, `probation_end`, `contract_end`, `end_date`.  
RLS: select self or co-members; update/delete admin (never owner row); **no direct insert** (join via `accept_invite`). Many fields changed via RPCs.

**`platform_admins`**  
`user_id` PK. Select: self only.

**`platform_settings`**  
Singleton `id=true`; `approval_required`, `config jsonb`, `trial_days`, `currency`, `lifetime_code`. Select: platform admin.

**`platform_audit` / `company_audit`**  
Append-only style logs. Platform audit: platform read. Company audit: **`is_company_admin` select**.

**`company_invites`**  
`email`, `role` (≠ owner), `role_label`, `token`, `expires_at`, `accepted_at`. Admin CRUD. RPCs: `get_invite(p_token)` (anon+auth), `accept_invite(p_token)`.

**`departments` / `job_titles`**  
Per-company org. Select: members. Write: admin (job_titles write also `is_company_hr`). `job_titles.crew_group` ∈ Captain/Deck/Engineering/Shore/Other.

### Settings key pattern

Stored in `companies.settings` as jsonb object.  
Key format: `{categoryIndex}_{slug(title)}` where slug = lower, `&`→`and`, non-alnum→`_`, trim, max 48 (`settings-engine.js`).  
Must match `^[a-z0-9_]{1,60}$`. Updated only via **`set_company_setting(p_company, p_key, p_value)`** (audits `setting_changed`).

---

## 3. Domains

### 3.1 Auth / org / platform / subscriptions

**Tables:** `companies`, `profiles`, `company_members`, `company_invites`, `platform_admins`, `platform_settings`, `platform_audit`, `company_audit`, `departments`, `job_titles`, `subscription_plans`, `subscription_requests`.

**`subscription_plans`:** `id`, `name`, `amount`, `interval_unit` (`month`/`year`/`lifetime`), … — authenticated read all.  
**`subscription_requests`:** open renewals; managed by platform RPCs.

**RPCs (purpose):**

| RPC | Args | Purpose |
|-----|------|---------|
| `get_invite` | `p_token` | Public invite preview |
| `accept_invite` | `p_token` | Join company |
| `set_member_org` | `p_company`, `p_user`, `p_patch` | Dept/title/manager/employee fields (HR may also after 0023) |
| `assign_employee_no` | `p_company`, `p_user` | Next ID from `2_employee_id_format` |
| `set_company_setting` | `p_company`, `p_key`, `p_value` | Write one settings key (see §4) |
| `platform_stats` / `platform_overview` / `platform_set_status` / `platform_set_approval` / `platform_set_config` | … | Platform owner console |
| `company_subscription` | `p_company` | Trial/active/lifetime/expired + plans |
| `redeem_code` | `p_company`, `p_code` | Lifetime unlock (rate-limited) |
| `request_renewal` | `p_company`, `p_plan` | Open billing request |
| `platform_billing` / `platform_company_subs` / `platform_renewals` / `platform_set_billing` / `platform_save_plan` / `platform_set_company_trial` / `platform_resolve_renewal` | … | Platform billing |

**Storage:** bucket **`company-logos`** (public). Path `{company_id}/...`. Write: `is_company_admin`; read: `is_company_member`.

---

### 3.2 Settings store

No separate settings table — **`companies.settings`**.  
RPC: `set_company_setting` (final ACL in 0035: adds Operations for 3_/4_/5_/6_).  
Platform: `platform_settings.config` via `platform_set_config`.

---

### 3.3 HR — crew / roster / leave / attendance / timesheets / payroll / docs / agreements / notifications

#### Crew & employment

**`staff_certifications`:** `(company_id,user_id)` FK members; `name`, `valid_until`, `issuer`, `cert_no`.  
RLS: HR or self read; HR write.

**`leave_requests`:** type, dates, `status` Pending/Approved/Rejected, `decision_note`, decided_*.  
RLS select: HR, self, or named leave approvers (`leave_approver_ids`). Insert: HR or self. No update policy — **`decide_leave`**.

**`member_private`:** `phone`, `emergency_contact`, `status_reason`. Select: HR or self. Writes via RPCs only.

**`employee_events`:** activity history. Select: HR or self. Inserts via triggers/internal.

**RPCs:** `set_member_hr`, `set_member_profile`, `set_member_status`, `decide_leave(p_id, p_approve, p_note)`, `leave_approver_ids`, `crew_check`, `crew_availability`, `has_expired_cert`, …

#### Roster

**`roster_entries`:** PK `(company_id,user_id,day)`, `shift`. Select: members. Write only **`set_roster`**.  
**`roster_periods`:** `(company_id,period_start)`, `period_end`, `status` draft/published/amended/locked. Select: members. Write via `publish_roster` / `set_roster_period_status`.

**RPCs:** `set_roster(p_company, p_rows)` — cells `{u,d,s}`; enforces approved leave, rest/hours, period lock; certs/quals only when `8_crew_assignment_rules.expired`/`.qualified` are true (default false since 0043; the UI shows an amber mark instead). Attendance **Absent does not block** (0042); attendance **On leave** still blocks via `roster_extra_block`. `publish_roster`, `set_roster_period_status`, `roster_coverage_gaps`, `can_edit_roster`.

#### Shift swaps (0061)
**`shift_swaps`:** `company_id, requester, partner, day, requester_shift, partner_shift, reason, needs_approval, status` (`pending_partner` → `pending_approval` → `approved`; or `declined` / `rejected` / `cancelled`), `partner_note, decided_by, decided_at, decision_note, meta jsonb`. One open request per requester and day. Select: requester, partner, HR, and (when `needs_approval`) the approvers once the partner answered. Writes only through the RPCs.
**Rule (HR Settings → Shift Swap Rules, key `8_shift_swap_rules`):** `{enabled (default true), hod (default true), scope 'Anyone' | 'Same designation' | 'Same crew group' (default Same designation since 0063; Anyone before), notice (hours, default 0)}`; read it with `swap_rules(p_company)`.
**Approvers:** `swap_approver_ids(p_id)` = requester's `manager_id` + department `head_user_id` + people/backup named for **Crew assignments**; HR if none; never the two people swapping.
**RPCs (authenticated):** `request_shift_swap(p_company, p_partner, p_day, p_reason)` (same-day swap; both need a shift, different shifts, not L/TRN) · `respond_shift_swap(p_id, p_accept, p_note)` (partner only; with `hod` off the roster swaps right here) · `decide_shift_swap(p_id, p_approve, p_note)` (approvers or HR) · `cancel_shift_swap(p_id)` · `my_shift_swaps(p_company)` → list with `role` requester/partner/approver and `can_approve` · `swap_candidates(p_company, p_day)` → colleagues with a shift that day (`user_id, name, shift, designation`), already filtered by the `scope` rule, which `request_shift_swap` also enforces (0062; `my_shift_swaps` adds `requester_title` / `partner_title`). The swap goes through `roster_apply` (all `set_roster` checks: rest, hours, leave, locked period); a failure raises and the request stays open. Notifications: kinds `swap_request`, `swap_approval`, `swap_result`.
**Internal:** `swap_title`, `swap_same_group` (0062), `roster_apply(p_company, p_rows)` (set_roster without the permission check; `set_roster` now checks `can_edit_roster` then calls it), `swap_apply`, `swap_name`. Tests: `tests/test_shift_swaps.py`.

#### Leave self-service (0068)

- The website's request form still inserts into `leave_requests` directly (checks in JavaScript). `request_leave` applies the same rules in the database and also refuses overlaps with your own pending or approved leave, which the website form does not yet check.

#### My approvals (0067)

- Not covered yet (still website only): purchase requests, work orders, timesheets, payroll runs.
- Item fields by kind: leave `{title (leave type), start, end, days, note}`; swap `{day, requester_shift, partner, partner_shift, note}`; attendance `{day, clock_in, clock_out, proposed_status, note}`; decided items add `status`, `decided_at`, `decision_note`.

#### Phone positions (0066)

- `share_vessel_position` is the client for crew-phone tracking (the phone sends fixes only while checked in to a vessel; no check-in or "No vessel" = refused; replays with the same `p_client_ref` are `duplicate`). It calls `arrival_ingest` with source `crew_device`, so fixes count for arrival detection only when `3_arrival_detection.allowCrewDevices` is on. An arrival confirmed only from phone fixes is recorded with method `crew_device_geofence`.
- `vessel_live_positions` → `[{vessel_id, code, name, vessel_status, lat, lng, accuracy_m, speed_kn, heading, source, observed_at, received_at, age_s, stale (older than 30 min), trip{id,code,status}, state}]`. Raw `vessel_positions` stay unreadable.
- Clients: iPhone `PositionSharing.swift`, Android `AppViewModel` (`startSharing`), website map `operations.js` (`refreshLivePositions`, every 30 s). Works while the app is open.

#### Attendance breaks (0065)

- `attendance_breaks(id, company_id, user_id, day, break_in, break_out, source, meta)`; one open break per person. Select: own rows and HR. Written only by `break_punch`.
- `my_break_state(p_company)` → `{enabled, allowance, clocked_in, on_break, break_since, used_minutes, breaks[]}` for the signed-in person's open shift.
- `break_punch(p_company, p_kind)` — needs breaks switched on in `8_attendance_rules` (`breaks`, `break_minutes`), an open shift, and allowance left. Audits `break_in` / `break_out`.
- Clocking out (self, HR or correction) closes any open break. Website: Attendance register shows Break in / Break out and a Break column; apps not yet.

#### Operations check-in (0064)
Staff have two check-ins: the **shift** check-in (attendance, `clock_punch`) and the **Operations** check-in (this section). Operations check-in records who worked Operations, on which vessel, when and from where. Without it the mobile apps are in **look-up mode** (read only). Checking in unlocks Mark paid, Check in / Board passenger, No-show and Cancel.
**`ops_checkins`:** `company_id, user_id, vessel_id, trip_id, checked_in_at, checked_out_at, lat, lng, device, source` (default `app`), `meta jsonb`. Select: own rows, Operations, HR. Writes only through the RPCs.
**Rule (Settings → Operations Settings → Operations Check-in, key `3_operations_check_in`):** `{enabled (default true), enforce (default false), hours (default 16)}`; read with `ops_checkin_rules(p_company)`. `enforce` makes the database refuse the five actions without an open check-in; it is off by default because the website has no check-in button yet. A check-in never closed stops counting after `hours`.
**RPCs (authenticated):** `my_ops_checkin(p_company)` → `{rules, checked_in, current{id, checked_in_at, vessel_id, vessel, trip_id}, suggested_vessel, vessels[{id, code, name, status}]}` · `ops_checkin(p_company, p_vessel, p_trip, p_lat, p_lng, p_device)` (one open check-in per person; returns the same shape) · `ops_checkout(p_company)` · `ops_checkins_recent(p_company, p_limit default 50)` (Operations and HR only; the **website** "Recent check-ins" card; the apps do not show it).
**Gated (when `enforce` is on, via `ops_require_checkin`):** `set_passenger_status`, `update_booking` (mark paid), `cancel_booking`, `update_booking_passengers`, `refund_booking`. Calls with no signed-in user (cron, triggers, SQL editor) and the platform owner pass. Tests: `tests/test_ops_checkin.py`.

#### Attendance

**`attendance_records`:** PK day; `status` Present/Late/Absent/On leave/Rest day/Missed punch; clock_in/out; `scheduled_shift`, `source`. Select: HR or self.  
**`attendance_corrections`:** pending corrections. Select: HR, subject, or creator.

**RPCs:** `clock_punch(p_company, p_kind, p_lat, p_lng, p_device)` (0030 adds device/network), `punch_check`, `correct_attendance`, `decide_attendance_correction`, `import_attendance`, `refresh_attendance`, `upsert_attendance` (internal).

#### Timesheets

**`timesheet_weeks`:** PK week; scheduled/actual/overtime/holiday mins; rates; `days` jsonb; `overtime_paid`; `paid_run` → payroll; approved_*. Select: HR or self. Written by `approve_timesheet`.

**RPCs:** `timesheet_week`, `approve_timesheet`, `reopen_timesheet`, `timesheet_week_start`, …

#### Payroll & allowances

**`member_pay`:** basic, allowances jsonb, pension, pay_method. Select: HR or self. Write: **`set_member_pay`**.  
**`payroll_runs`:** Draft → Approved → Paid; period, totals. Select: `can_see_payroll` or own approved payslip.  
**`payroll_lines`:** per-user line on a run.

**RPCs:** `create_payroll_run`, `calc_payroll_run` (internal/recalc), `approve_payroll_run`, `mark_payroll_paid`, `reopen_payroll_run`, `delete_payroll_run`, `preview_allowances`, `preview_allowances_all`, `is_payroll_approver`. Rules from `8_allowance_rules` / `8_payroll_configuration`.

#### Staff documents

**`staff_documents` / `staff_document_versions`:** categories, expiry, visibility `hr_only`|`self_and_hr`, file paths.  
RLS: HR full; self if `self_and_hr`.

**Storage:** **`staff-documents`** (private). Path company/user based. HR write; HR or subject read.

#### Agreements

**`agreement_templates`:** body_html or docx_path; HR only.  
**`agreements`:** auto `number`, status Draft/Sent/Signed/Cancelled; staff may select Sent/Signed for self.

**Storage:** **`agreements`** (private). HR manage; staff can read own pdf/signed paths when Sent/Signed.

#### Notifications

**`notifications`:** per-user in-app; unique (company,user,kind,stage,subject_id). Select: self / HR / platform. Update read: self.  
**RPCs:** `scan_hr_notifications`, `mark_notifications_read`; writers `notify_user`/`notify_many` (not granted to clients broadly). Leave trigger `leave_notify`. Toggle: `11_in_app_notifications`.

---

### 3.4 IT

**Role:** `member_role` value `'it'`. Helper `is_company_it`.

**Tables:**

| Table | Key columns | RLS |
|-------|-------------|-----|
| `it_networks` | `cidr`, `kind`, `active`, `expires_at` | IT CRUD |
| `it_devices` | `device_key`, `status` Pending/Approved/Blocked, `kiosk`, `user_id` | IT select/update/delete; owner/registrant select; register via RPC |
| `it_assets` | name, warranty/licence dates, assignee | IT CRUD; assignee select |
| `it_tickets` | numbered, requester, status, priority | IT or requester select; IT update; open via RPC |
| `it_ticket_notes` | `internal` flag | `it_ticket_visible` |
| `it_events` | activity log | IT select |

**RPCs:** `it_network_status`, `register_device`, `punch_check`, `open_ticket`, `add_ticket_note`, `scan_it_assets`, …

**Storage:** none dedicated (no IT file bucket).

---

### 3.5 Maintenance / parts / purchasing

**Helpers:** `is_company_maint`, `is_maint_approver`, `maint_named`, `maint_user_ids`.

**Core tables:**

| Table | Notes | RLS (typical) |
|-------|-------|----------------|
| `vessels` | code, status Operational/Restricted/Out of service | members select; maint write; return-to-service via `release_vessel` |
| `vessel_components` | hours, tracks_hours | members select; maint write |
| `hour_readings` | history | members select; write via `log_hours` |
| `maint_schedules` | preventive days/hours | members select; maint write |
| `work_orders` | number/code, status, assignee, defect_id, parts_cost | members select; maint update/delete (draft/open); create via RPC |
| `defects` | numbered | members select; maint update; `report_defect` |
| `maint_checklists` / `maint_inspections` | inspections raise defects | members select; checklists maint write; `submit_inspection` |
| `maint_events` | log | members select |
| `maint_files` | ref_type vessel/component/work_order/defect/part/purchase_order/warranty_claim/supplier | members select/insert; maint or uploader delete |

**Parts / purchasing:**

| Table | RLS |
|-------|-----|
| `suppliers`, `parts` | members select; maint write |
| `part_stock`, `stock_moves` | members select; stock only via `stock_move` / `adjust_stock` / WO/PO RPCs |
| `purchase_requests` | maint or requester select; write via RPCs |
| `purchase_orders` | maint select; write via RPCs |

**RPCs:** `create_work_order`, `wo_progress`, `wo_finish`, `complete_work_order`, `approve_work_order`, `report_defect`, `submit_inspection`, `set_vessel_status`, `release_vessel`, `log_hours`, `scan_maintenance`, `adjust_stock`, `wo_issue_part`, `request_parts`, `decide_purchase_request`, `cancel_purchase_request`, `save_purchase_order`, `receive_purchase_order`, `scan_low_stock`, …

**Storage:** **`maintenance`** (private, 50MB). Path company-prefixed. Members read/insert; maint delete.

**Settings keys (10_) wired in UI (Cursor, 2026-10-21):**  
`10_labour_rates_and_cost_categories` — suggests labour cost from hours × rate on work orders.  
`10_maintenance_document_requirements` — `photoDefect` requires a file on Critical defect reports; `reportClose` requires a file before closing contractor work orders.  
`10_service_interval_rules` — quick-fill chips when adding a preventive schedule.  
Other `10_` keys (categories, WO number format, reminders, return-to-service, approval) already enforced in RPCs/UI from 0031–0032. No new migration required for this settings completion.

### 0034 additions — costs, budgets, contractors, warranty, lifecycle, reports, planning calendar

Every RPC below is `security definer` and raises a plain-English error the UI can show as-is. Money is `numeric`. "maint" means `is_company_maint`: owner, admin or operations, plus the named maintenance people.

**New columns**

| Table | Column | Notes |
|-------|--------|-------|
| `work_orders` | `contractor_id uuid` → `suppliers.id` | The contractor who does the job. The old free-text `contractor` column stays. Set it with a direct update (maint). |
| | `cost_contractor numeric` | The contractor's invoice. Set it through `wo_progress` (patch key `cost_contractor`) or a direct update. |
| | `est_cost numeric` | Estimated cost, compared with actual in `maint_costs`. |
| | `planned_start`, `planned_end timestamptz`, `takes_out_of_service boolean`, `est_downtime_hours numeric` | Set these **only through `plan_work_order`**, so the clash checks run. |
| `suppliers` | `kind` (`Supplier` / `Contractor` / `Both`, default `Supplier`), `services`, `agreement_ref`, `agreement_until date`, `hourly_rate`, `rating smallint 1–5` | Contractor profile and service agreement. Edit directly (maint). |
| `vessels` | `warranty_until date` | Vessel warranty. |
| `vessel_components` | `expected_life_hours`, `expected_life_years`, `supplier_id`, `retired_on`, `disposed_on`, `disposal_note` | Lifecycle data. Setting `status = 'Retired'` fills in `retired_on`. Setting `disposed_on` writes a "Disposed" event. |

**New tables**

| Table | Columns | RLS |
|-------|---------|-----|
| `maint_budgets` | `id, company_id, year, month (null = whole year), vessel_id (null = fleet), category ('Total','Labour','Parts','Contractor','Other'), amount, note` | Unique per (company, year, month, vessel, category). Maint can select, insert, update and delete. Reports use `category = 'Total'` rows. |
| `technician_skills` | PK `(company_id, user_id, skill)`, `level` (`Learning` / `Qualified` / `Expert`), `note` | Members can select. Maint can write. |
| `component_events` | `id, company_id, vessel_id, component_id, kind ('Installed','Overhaul','Repaired','Replaced','Removed','Retired','Disposed','Warranty claim'), on_date, hours_at, cost, work_order_id, note, actor` | Members can select. Maint can insert, but `actor` must be `auth.uid()`. Maint can delete. Installed, Retired, Removed, Disposed and Warranty claim events are written automatically. The UI adds Overhaul, Repaired and Replaced. |
| `warranty_claims` | `id, company_id, number (show as WC-n), vessel_id, component_id, supplier_id, defect_id, work_order_id, title, detail, status ('Draft','Submitted','Approved','Rejected','Paid'), claimed_amount, recovered_amount, supplier_ref, submitted_on, decided_on, created_by, created_at, updated_at` | Maint only. Create with `open_warranty_claim`. Status and amounts are changed by direct update; the dates fill in automatically. Only a Draft can be deleted. Attach files with `maint_files` `ref_type = 'warranty_claim'`. |
| `vessel_status_periods` | `id, company_id, vessel_id, status, reason, from_at, to_at (null = now)` | Members can select, read-only. Written automatically whenever a vessel's status changes. Feeds the downtime and availability figures. |

**New RPCs**

| RPC | Returns | Use |
|-----|---------|-----|
| `maint_costs(p_company uuid, p_from date, p_to date, p_group text default 'vessel')` | `[{key, label, jobs, labour, parts, contractor, other, total, estimate, budget}]`, biggest total first | Cost of completed or closed jobs. `p_group` is `vessel`, `component`, `month` (key `YYYY-MM`), `kind` or `category`. `budget` is filled for `vessel` and `month`. |
| `maint_budget_vs_actual(p_company uuid, p_year int, p_vessel uuid default null)` | 12 × `{month, budget, actual}` | Monthly chart. An annual budget is spread over 12 months. With `p_vessel = null` it shows fleet budgets. |
| `maint_technicians(p_company uuid, p_skill text default null, p_from timestamptz default null, p_to timestamptz default null)` | `[{user_id, name, skills[], level, on_leave, open_jobs, clash}]`, best first | The "who can do this job" picker. Leave status comes from approved `leave_requests`. `clash` means they have another planned job in the window. |
| `open_warranty_claim(p_company uuid, p_row jsonb)` | `warranty_claims` row | `p_row`: `title` (required), `component_id`, `vessel_id`, `supplier_id`, `defect_id`, `work_order_id`, `detail`, `claimed_amount`, `supplier_ref`. If a component is given, the vessel and supplier default from it. |
| `plan_work_order(p_id uuid, p_start timestamptz, p_end timestamptz, p_out boolean default false, p_downtime numeric default null)` | `work_orders` row | Puts a job on the calendar. Passing `p_start = null` takes it off. **Clash rules:** two out-of-service jobs on the same vessel can't overlap, and one assignee can't have two planned jobs at once. Out-of-service plans notify owner, admin, operations and the maintenance people (kind `maint_plan`). The assignee gets a `work_order` notice. |
| `maint_calendar(p_company uuid, p_from date, p_to date)` (window of 100 days or less) | `[{type, id, vessel_id, vessel, title, start, end, status, ...}]` | Three item types. `type='job'` is a planned job, or an unplanned one by its `due_on`; it adds `code, priority, out_of_service, assignee, planned`. `type='due'` is a preventive schedule falling due that has no open job yet; it adds `next_hours, hours`. `type='down'` is a period when the vessel was Restricted or Out of service. Any member can read it (Operations uses it). |
| `maint_report(p_company uuid, p_from date, p_to date)` (period of 400 days or less) | one jsonb object | The keys are listed below. |

`maint_report` keys:
- `vessels`: one row per vessel with `jobs_done, jobs_open, defects, breakdowns, inspections, failed_items, cost, downtime_hours, restricted_hours, availability_pct`.
- `schedules`: upcoming and overdue preventive work, with `state, next_on, next_hours, hours`.
- `repeat_defects`: components with 2 or more defects, with `count, last, titles[]`.
- `parts_used`: `part_no, name, unit, qty, cost`.
- `costs_by_vessel` and `costs_by_component`, in the same shape as `maint_costs`.
- `cost_per_hour`: `component, vessel, hours_run, cost, per_hour`, from engine hour readings in the period.
- `technicians`: `name, completed, labour_hours, avg_days, on_time_pct`.
- `contractors`: `name, rating, agreement_until, jobs, cost, on_time_pct, callbacks`. A callback is a defect on the same component within 30 days of the job.
- `planned_vs_unplanned`: `planned_jobs, unplanned_jobs, planned_cost, unplanned_cost`. Preventive and Inspection jobs count as planned.
- `compliance`: `preventive_done, on_time, on_time_pct, overdue_now, open_stopping_defects`.
- `warranty`: `claims, claimed, recovered, open`.
- `from, to, period_hours`.

**Changed (same signatures)**
- `wo_progress(p_id, p_patch)`: the patch can now also include `cost_contractor`.
- `scan_maintenance(p_company)` now also does four things:
  1. Takes a vessel **Out of service** when a planned out-of-service job has started, with reason "Planned: WO-…".
  2. Sends warranty-ending reminders (`maint_warranty`) for components and vessels.
  3. Sends contractor-agreement-ending reminders (`maint_contract`).
  4. Sends monthly fleet budget alerts (`maint_budget`) once spend reaches `warnPct`, and again when it goes over.
  The reminder window is `10_maintenance_reminder_rules.first` days (default 14). Keep calling it when maintenance.html loads.
- `vessels_guard` trigger: also writes `vessel_status_periods`.

**Settings:** `10_maintenance_budget_rules` = `{ "warnPct": number }` (default 90). It is a new key; please add it to Maintenance Settings.

**Return to service is unchanged:** a vessel taken out of service by a planned job still comes back only through `release_vessel`.

### Fleet UI and Schedules UI requests — done in 0035/0036 (see §3.6)

### 3.6 Operations — fleet, routes, schedules (0035, 0036)

**Helpers:** `is_company_ops(cid)` returns true for owner, admin, operations and the platform owner. `ops_user_ids(company)`. `company_tz(company)` returns `companies.timezone` (default Indian/Maldives). `local_time(company, ts)` returns text like 'DD Mon HH24:MI' in company time.

**Built to extend without new SQL:**
- **`meta jsonb`.** Every table below (and `vessels`) has `meta jsonb not null default '{}'`. It must be an object, up to 16 KB. Put any new field the UI needs in it, such as a pier, a colour, a charter client or a checklist.
- **Free text instead of fixed lists.** `kind` on trips and templates (2–40 chars) and `trip_crew.role` are free text. Keep the option lists in settings: `5_schedule_types` for trip kinds, `3_trip_statuses` for labels and colours only.
- **Settings Operations can save.** Operations (and owner/admin) can save any key with prefix `3_` (Operations), `4_` (Routes & Locations), `5_` (Schedule) or `6_` (Fleet) through `set_company_setting`.
- **What stays fixed.** Only `trips.status` is a fixed list, because clash checks depend on it: `Scheduled`, `Boarding`, `Departed`, `Arrived`, `Delayed`, `Cancelled`.

**`vessels` new columns:** `passenger_capacity int`, `crew_capacity int`, `assigned_route text ≤120`, `standby boolean` (default false), `meta jsonb`. Write them directly; the maint RLS from 0031 applies (owner, admin, operations or the maintenance people). Show **Standby** when `status = 'Operational' and standby`; the maintenance statuses and return-to-service are unchanged.

**Tables.** For all four: members can select. Insert, update and delete need `is_company_ops`, except trip status, which goes through `set_trip_status`.

| Table | Columns | Notes |
|-------|---------|-------|
| `routes` | `id, company_id, code (unique, optional), name (unique), origin, destination, stops text[], duration_min, distance_nm, fare, active, note, meta, created_at` | A route that is used by trips can't be deleted. Set `active = false` instead. |
| `schedule_templates` | `id, company_id, name, route_id, vessel_id, captain_id, kind, depart_time time, duration_min, weekdays smallint[]` (ISO: 1 = Mon … 7 = Sun)`, seats, valid_from, valid_to, active, meta` | Repeating sailings. Turn them into trips with `generate_trips`. |
| `trips` | `id, company_id, route_id, vessel_id, captain_id, template_id, kind, status, depart_at, arrive_at, seats_total, seats_booked, status_reason, note, actual_depart, actual_arrive, meta, created_by, created_at, updated_at` | Insert and update directly (ops). See the trigger rules below. If `arrive_at` is empty it is filled from the route duration, and `seats_total` defaults to the vessel's capacity. |
| `trip_crew` | `trip_id, company_id, user_id, role, meta` (PK `trip_id, user_id`) | Crew per trip. Insert and delete directly (ops). The same person can't be on two trips that overlap, and can't be added while on approved leave. |

**Trip rules** (enforced on every insert and update; cancelled and arrived trips are skipped). If a trip breaks one, the save fails and the error message (in local time) can go straight into a toast:
- The route, vessel and captain must belong to the company.
- The vessel must not be Out of service within the next 24 hours.
- The vessel must not be booked out of service by a planned maintenance job (`plan_work_order`).
- The vessel must not have another trip that overlaps.
- `seats_total` must not be more than `passenger_capacity`.
- The captain must be active staff, not on another trip or crew at the same time, and not on approved leave.

The same check runs the other way: `plan_work_order` refuses an out-of-service job over booked trips.

**RPCs**

| RPC | Returns | Use |
|-----|---------|-----|
| `schedule_trips(p_company uuid, p_from timestamptz, p_to timestamptz)` (window of 93 days or less) | `{trips: [...], summary: {trips, vessels, routes, crew, cancelled, delayed, seats}}` | Feeds the Daily, Weekly, Route and Vessel views and the summary tiles. Each trip has `id, route_id, route, origin, destination, vessel_id, vessel, vessel_code, captain_id, captain, crew[{user_id,name,role,meta}], kind, status, status_reason, depart_at, arrive_at, seats_total, seats_booked, seats_available, template_id, note, meta, route_meta`. Any member can call it. |
| `set_trip_status(p_id uuid, p_status text, p_reason text default null, p_new_depart timestamptz default null)` | `trips` row | Ops or the trip's captain. `Delayed` and `Cancelled` need a reason and notify the captain, the crew and Operations (kind `trip`). `p_new_depart` moves the trip; arrival moves with it, and the clash rules run again. |
| `generate_trips(p_template uuid, p_from date, p_to date)` (92 days or less) | `{created, skipped: [{date, error}]}` | Creates the template's trips on its weekdays, in company time. Running it again for the same range creates nothing twice. Days that clash are skipped and reported. |
| `copy_trips(p_company uuid, p_from_day date, p_to_day date)` | `{created, skipped: [{trip, error}]}` | The "Duplicate day" tool. Crew is copied too. |
| `import_trips(p_company uuid, p_rows jsonb)` (1000 rows or fewer) | `{created, errors: [{row, error}]}` | Parse the CSV in the browser and send an array of rows. Each row: `{route (name or code) or route_id, vessel (code or name) or vessel_id, date 'YYYY-MM-DD', time 'HH:MI'` (or `depart_at`)`, arrive_time` (or `arrive_at`)`, kind, seats, note, meta}`. Good rows are saved even if others fail. |

**Times:** store `timestamptz`. Templates and imports use company local time (`companies.timezone`). Error messages and notices show local time.

### 3.7 Operations dispatch (0037) — `operations.html`

**Trip statuses.** `trips.status` is any text of 2–30 characters. `set_trip_status` accepts the built-in statuses (Scheduled, Boarding, Departed, In transit, Arrived, Delayed, Cancelled, Completed) plus any names in `3_trip_statuses`, an array of strings or `{name}` objects. `trip_closed(status)` is true for **Cancelled, Arrived and Completed**; closed trips are left out of clash checks. Use the setting for colours and labels.

**New `trips` columns:**
- `number int` and `code text`, filled automatically when a trip is created. The format comes from `3_trip_number_format` `{prefix (default TR), sep, year, digits, start}`.
- `cleared_at`, `cleared_by`, `clearance jsonb`. Clearance resets whenever the vessel, captain or departure time changes.

`schedule_trips` now also returns `code, number, cleared_at, actual_depart, actual_arrive, closed`.

**Tables**

| Table | Columns | RLS |
|-------|---------|-----|
| `trip_events` | `id, company_id, trip_id, kind ('created','status','moved','assigned','cleared','task'), detail, actor, meta, created_at` | Members can select, read-only. Written automatically. Use it for the trip history drawer. |
| `dispatch_tasks` | `id, company_id, trip_id (null for a general task), title, detail, priority (free text; UI uses High / Due / Review), blocks_dispatch bool, status ('Open','Done','Dismissed'), assignee, due_at, done_at, done_by, done_note, meta, created_by, created_at` | Members can select. Ops can insert, update and delete. Finish a task with `finish_dispatch_task`. |
| `ops_advisories` | `id, company_id, kind (free text, e.g. Weather / Pier notice / one of 3_incident_categories), severity ('Info','Warning','Critical'), title, detail, route_id, vessel_id, trip_id, blocks_dispatch bool, starts_at, ends_at, resolved_at, resolved_by, meta, created_by, created_at` | Members can select. Ops can insert, update and delete; to resolve one, set `resolved_at` and `resolved_by`. Any member can report through `report_incident`. Warning and Critical items notify Operations plus the linked trip's captain and crew (kind `ops_advisory`). |

**RPCs**

| RPC | Returns | Use |
|-----|---------|-----|
| `ops_board(p_company uuid, p_day date default null)` (today in company time when null) | `{day, kpis, trips, queue, advisories}` | Feeds the whole board. See the details below. |
| `clear_trip(p_id uuid, p_checks jsonb default '{}', p_note text default null)` | `trips` row | Pre-departure clearance (ops). See the rules below. |
| `set_trip_status(p_id, p_status, p_reason default null, p_new_depart default null)` | `trips` row | Same signature as 0035. See the rules below. |
| `finish_dispatch_task(p_id uuid, p_done boolean default true, p_note text default null)` | `dispatch_tasks` row | Ops or the assignee. `p_done = false` dismisses the task instead. |
| `report_incident(p_company uuid, p_row jsonb)` | `ops_advisories` row | Any member. `p_row`: `title` (required), `kind` (default Incident), `severity`, `detail`, `route_id`, `vessel_id`, `trip_id`, `meta`, and `blocks_dispatch` (only applied for ops). |
| `scan_operations(p_company uuid)` | integer (trips changed) | Call when `operations.html` loads. See the rules below. |

**`ops_board` returns:**
- `kpis`: `{active, awaiting, delayed, cancelled, crew_on_duty}`. `crew_on_duty` counts members with `duty_status = 'On duty'`.
- `trips`: the same shape as `schedule_trips` for that day.
- `queue`: open `dispatch_tasks`, plus automatic items with `auto: true`, such as "Clear TR-… for dispatch" for trips inside the dispatch window that aren't cleared yet. Each item: `{id, auto, trip_id, code, title, sub, priority, due_at, assignee, blocks_dispatch}`.
- `advisories`: active advisories, Critical first, each with `tone` (`warn` / `clock` / `ok`) to match your icons.
- For the Upcoming, Completed and Cancelled tabs, call `schedule_trips` over a wider window.

**`clear_trip` rules.** The settings come from `3_dispatch_rules`:
- `lead` (default 60): clearance can only happen within this many minutes of departure.
- `crew` (default on): a captain must be assigned.
- `checklist` (default on): the vessel needs a checklist with no failed items on the trip's date, or `p_checks.checklist = true`.
- `weather` (default on): needs `p_checks.weather = true`.

These are always required:
- The vessel is not Out of service.
- The vessel has no open defect that stops operation.
- There are no open blocking tasks.
- No active blocking advisory covers the trip, route or vessel. An advisory with no trip, route or vessel covers everything.

If anything fails, one error lists all of it: "Not ready to dispatch: A; B; C." Show it as-is.

**`set_trip_status` rules:**
- Boarding, Departed and In transit need clearance, unless `3_dispatch_rules.enforce = false`.
- Delayed always needs a reason.
- Cancelled needs a reason unless `3_trip_cancellation_rules.reason = false`.
- Delayed and Cancelled notify the captain, crew and Operations.

**`scan_operations` rules.** The settings come from `3_departure_and_arrival_rules`:
- A Scheduled or Boarding trip that hasn't left `late` minutes after departure (default 15) becomes Delayed, and Operations is notified.
- If `auto` is on (default), a Departed or In transit trip becomes Arrived `arrival` minutes after its arrival time (default 30).

**Mapping the UI to the database:**
- "On time" is shown, not stored: a trip that is cleared and not delayed.
- "Completed" is a real status.
- "Awaiting dispatch" is the `kpis.awaiting` count.
- The new-trip modal inserts into `trips` with `route_id` from a `routes` picker, not free text. A vessel is optional.

### Reports UI (Cursor, 2026-10-21) — DONE in 0047 (see §3.12)

Page: `reports.html` / `reports.js` / `reports.css`.  
UI: KPI strip (templates / exports / scheduled / data sources), **Report library** (8 built-in templates, tabs All · Operations · Finance · HR · Fleet), **Recently generated**, **Quick export**, Create custom report. Module toggle: `17_module_and_feature_management.reportHub` (default on; separate from HR `reports`).

Templates are defined in the UI (trip performance, revenue & expense, vessel utilization, incident/safety, passenger movement, crew attendance, maintenance history, route comparison). **Generate / schedule / recent list wait on DB.**

**Please add (next migration) for Reports:**

| Table / concept | Purpose |
|-----------------|---------|
| `report_runs` | Generated export: company_id, template_id (text slug or uuid), title, format (PDF/XLSX/CSV), status, from_date, to_date, file path or storage key, created_by, created_at |
| optional `report_schedules` | Recurring: template, cadence, recipients, next_run |
| optional `report_defs` | Custom reports created in UI (name, area, filters jsonb) |
| storage bucket `reports` (private) | PDF/XLSX blobs; company-scoped path |
| RPC `run_report(p_company, p_template, p_from, p_to, p_format)` | Builds file + inserts `report_runs`; or return URL |

Each template pulls from existing modules (trips, finance ledger, vessels, HR attendance, maintenance, bookings). Until then UI shows empty “Recently generated” and Generate explains DB not ready.

### Finance UI (Cursor, 2026-10-21) — DONE in 0046 (see §3.11)

Page: `finance.html` / `finance.js` / `finance.css`.  
UI: KPI strip (Total revenue / Total expenses / Net profit / Outstanding invoices), Revenue & expenses chart (Revenue|Expenses + period), Recent transactions, Revenue by route, Expense categories. Module toggle: `17_module_and_feature_management.finance` (default on). Currency from `companies.currency` (fallback MVR). Settings: **Finance Settings** (`9_*` — Base Currency, Revenue/Expense Categories, Invoice Number Format, …).

**Empty until ledger exists.** All KPIs `0` / `MVR 0`, empty chart and lists. Export report shows “waiting on DB”.

**Please add (next migration) for Finance:**

| Table / concept | Purpose |
|-----------------|---------|
| `finance_entries` or ledger | Dated lines: `kind` (revenue / expense / refund), `amount`, `currency`, `category` (from `9_revenue_categories` / `9_expense_categories`), optional `route_id`, `vessel_id`, `trip_id`, `booking_id`, `note`, `meta` |
| `invoices` | Outstanding receivables: number (`9_invoice_number_format`), status, amount, due_on, customer/passenger link |
| optional RPC `finance_summary(p_company, p_from, p_to)` | Returns KPIs, daily series, by-route revenue, by-category expenses, recent tx — feeds this page in one call |
| ticket sales feed | When Passengers bookings are paid, write revenue entries (or derive in the RPC from bookings) |
| maintenance / fuel / payroll costs | Expense entries from work orders, fuel logs, payroll runs (or link existing `maint_costs` / payroll) |

RLS: company members with ops/admin (or a future finance role) select/write. Do not invent demo figures in the UI.

### Passengers UI (Cursor, 2026-10-21) — needs Claude tables

Page: `passengers.html` / `passengers.js` / `passengers.css`.  
UI: KPI strip (Passengers today / Confirmed / Checked in / Awaiting check-in), tabs All · Bookings · Check-in · Trip manifests, registry table, **Boarding progress**, tools (manifest / verification / history). Module toggle: `17_module_and_feature_management.passengers` (default on). Settings category **Passenger & Booking Settings** (`7_*`).

**Empty until tables exist.** KPIs at zero, empty registry, empty boarding rail. **Add passenger** validates name then reports DB not ready. Tools show short “waiting on DB” notes.

**Please add (next migration) for Passengers:**

| Table / concept | Purpose |
|-----------------|---------|
| `passengers` | Company passenger profile: name, document/ID, phone, email, category (Adult/Child/… from `7_passenger_categories`), meta |
| `bookings` | Link passenger ↔ trip: booking ref (`7_booking_reference_format`), ticket type, status (`Confirmed` / `Checked in` / `Pending` / `Cancelled` — align with `7_booking_statuses`), seats, booked_at |
| check-in | Timestamp / pier / verifier on booking or `booking_checkins`; drive Checked in vs Pending |
| trip manifest | Query or RPC: passengers on a trip for export / boarding progress (booked vs `trips.seats_total`) |
| optional history RPC | Past journeys for a passenger |

RLS: company members select; operations + admin write (same as Schedules/Operations).  
Link bookings to existing `trips` / `routes`. Do not invent fake passengers in the UI until this ships.

### 3.8 Passengers & bookings (0038)

**Tables.** Members can select all three. Writes go through the RPCs below, except `passengers`, which members can also insert and update directly.

| Table | Columns |
|-------|---------|
| `passengers` | `id, company_id, full_name, phone, email, id_number` (unique per company), `nationality, dob, category, emergency_contact, note, meta, created_by, created_at, updated_at`. Filled automatically from bookings: passengers are matched by ID number, otherwise added. |
| `bookings` | `id, company_id, number, reference` (from `7_booking_reference_format`, e.g. BK-2026-000001)`, trip_id, source` (free text: Manual / Walk-up / Customer / API)`, status` (free text; **Cancelled** and **Refunded** free the seats)`, contact_name, contact_phone, contact_email, ticket_type, passenger_count, fare_total, paid_amount, payment_method, payment_status` (Unpaid / Partly paid / Paid / Refund due / Refunded)`, refund_amount, cancel_reason, cancelled_at, note, api_key_id, meta, created_by, created_at, updated_at` |
| `booking_passengers` | `id, company_id, booking_id, trip_id, passenger_id, full_name, category, id_number, nationality, phone, seat_no, fare, status` (Booked / Checked in / Boarded / No-show / Cancelled, or any other text)`, checked_in_at, checked_in_by, boarded_at, meta, created_at` |

**RPCs**

| RPC | Use |
|-----|-----|
| `create_booking(p_company, p_trip, p_booking jsonb, p_passengers jsonb)` → booking JSON | Counter, phone and walk-up bookings. `p_booking`: `{contact_name, contact_phone, contact_email, ticket_type, status, source, payment_method, paid_amount, note, meta}`. `p_passengers`: `[{passenger_id?, full_name, category, id_number, nationality, phone, email, dob, emergency_contact, seat_no, fare?, meta, save?}]`. A passenger's fare defaults to `routes.meta.fares[category]`, else `routes.fare`. The rules below are checked first. |
| `update_booking(p_id, p_patch)` | Change contact, ticket, status, payment, note or meta. `trip_id` moves the booking to another trip. |
| `update_booking_passengers(p_booking, p_add jsonb, p_remove uuid[])` | Add passengers to a booking, or cancel some of them. |
| `cancel_booking(p_id, p_reason, p_refund default null)` | The refund is worked out from `7_cancellation_and_refund_rules` (`full` hours, `partial` hours, `partialPct`, `operator`) unless you pass `p_refund`. |
| `refund_booking(p_id, p_amount default null)` (ops) | Records the refund as paid out. |
| `set_passenger_status(p_id, p_status)` | Check-in only works within `7_check_in_rules.opens` minutes of departure (default 60). Boarded and No-show work at any time. |
| `trip_manifest(p_trip)` | `{counts: {booked, checked_in, boarded, no_show, cancelled, revenue}, sellable, seats_booked, passengers: [...]}` |

**Booking rules:**
- **Capacity:** `trips.seats_total` (defaults to the vessel's passenger capacity), minus the `3_passenger_capacity_rules` buffer % and `crewSeats`. Setting `block = false` allows overbooking.
- **Cut-off** (customer and API bookings only): `7_booking_cut_off_times.close` minutes and `advance` days. Staff can book walk-ups after departure while `walkup` is on.
- **Required details:** `7_required_passenger_information`.

When a trip is cancelled, its bookings are cancelled automatically with a full refund, because it's the operator's cancellation.

### 3.9 Operations automation (0039)

pg_cron job **`veyora_ops_tick`** runs `ops_tick()` every minute, which runs `ops_auto(company)` for every active company. `scan_operations(p_company)` still exists, so a page can ask for a run now. Every automatic change is written to `trip_events` with kind `auto`.

- **Trips from templates:** `5_recurring_trip_rules` `{horizon: '30 days', auto: true}`. Days that clash are skipped.
- **Crew from the roster** (`3_auto_crew_rules` `{enabled, hours 48, captain, deck 1, engineering 1}`; `vessels.meta.crew` overrides the numbers per vessel):
  - Only empty places are filled.
  - A person qualifies when their job title's crew group matches, their roster shift (Shift Definitions times) covers the whole trip, they pass `crew_check` (status, leave, absence, certificates), and they aren't on another trip.
  - People assigned to that vessel are preferred, then whoever has the fewest trips that day.
  - Staff can trigger it with `assign_trip_crew(p_company)`.
- **Status by the clock** (`3_departure_and_arrival_rules`):
  - `autoBoarding` + `boarding` (15 minutes): Scheduled → Boarding.
  - `autoDepart`: Departed at departure time, with `actual_depart` set to the scheduled time.
  - If the trip can't sail, it becomes Delayed with "Waiting: <reason>": no vessel, vessel out of service, a defect that stops operation, no captain (`needCaptain`), or not cleared (`needClearance`, off by default). It is re-checked every minute for 6 hours.
  - `auto` + `arriveAfter` (0): Arrived.
- **Passengers:**
  - At departure, Checked in → Boarded, and Booked → No-show if `7_check_in_rules.autoNoShow` is on.
  - On arrival, open bookings → Completed.

### 3.10 Company API (0040)

Customer and partner guide: **`supabase/COMPANY_API.md`**.

- **Table:** `company_api_keys` `(id, company_id, name, kind 'public'|'secret', prefix, key_hash, allowed_origins text[], rate_per_min, active, last_used_at, use_count, meta, created_by, created_at, revoked_at)`. Owners and admins can select. The key itself is stored only as a SHA-256 hash.
- **Admin RPCs:**
  - `create_api_key(p_company, p_name, p_kind default 'public', p_origins text[] default '{}', p_rate default 120)` returns the full key **once**.
  - `update_api_key(p_id, p_patch {name, allowed_origins, rate_per_min, meta})`
  - `revoke_api_key(p_id)`
- **Endpoints** (callable by `anon`; the key decides the company): `api_info`, `api_routes`, `api_trips`, `api_trip`, `api_book`, `api_booking`, `api_cancel`, plus `api_bookings` and `api_manifest`, which need a secret key.
- **Checks on every call:**
  - The key is active, and the company is Active with an open subscription.
  - The website origin is allowed, for public keys with `allowed_origins` set.
  - The per-minute rate limit is respected.

---

### 3.11 Finance (0046)

Access: `is_company_finance(cid)` = owner, admin, Operations (and platform owner). Settings used: `9_invoice_number_format`, `9_tax_configuration` (rate %, inclusive), categories from `9_revenue_categories` / `9_expense_categories` (free text in the tables).

| Table | Columns / rules |
|-------|-----------------|
| `finance_entries` | `id, company_id, entry_date, kind` (Revenue / Expense / Refund)`, amount > 0, currency, category, description, payment_method, route_id, vessel_id, trip_id, booking_id, invoice_id, source` (Manual / Booking / Refund / Invoice / Payroll / Maintenance)`, source_ref, meta, created_by, created_at, updated_at`. Select: finance. Insert/update/delete: finance, **Manual rows only**. Automatic rows are one per source record (unique `company_id, source, source_ref`). |
| `invoices` | `id, company_id, number, code, customer_name, customer_email, customer_phone, passenger_id, booking_id, category, issue_date, due_on, items [{description, qty, unit_price}], subtotal, tax, total, amount_paid, currency, status` (Draft / Sent / Partly paid / Paid / Void)`, payment_method, note, meta`. Finance can insert/update; delete Draft only. Number, code, totals, tax and status are set by trigger. |

Automatic ledger lines (triggers, kept in step on every change):
- `bookings.paid_amount` → Revenue "Passenger tickets" (route/vessel/trip from the trip); `refund_amount` once `payment_status = 'Refunded'` → Refund.
- `invoices.amount_paid` (not Void) → Revenue (invoice category).
- `payroll_runs` status Paid → Expense "Salaries" (`employer_cost`, else `gross`).
- `work_orders` Completed/Closed → Expense "Maintenance" (labour + parts + other + contractor). Purchase orders are not added separately.

RPCs: `finance_summary(p_company, p_from, p_to)`, `record_invoice_payment(p_id, p_amount, p_method)`, `is_company_finance(cid)`.

### 3.12 Reports (0047)

Access: `is_company_reports(cid)` = owner, admin, Operations, HR. `revenue_expense` also needs finance; `crew_attendance` needs HR.

| Table | Columns |
|-------|---------|
| `report_runs` | `id, company_id, template, def_id, title, format` (PDF/XLSX/CSV)`, status` (Generating/Ready/Failed)`, from_date, to_date, params, row_count, file_path, error, created_by, created_at, finished_at`. Select: reports; written by RPCs; delete own (admin any). |
| `report_defs` | `id, company_id, name, area, template, filters, columns, meta` — saved custom reports. Reports access can CRUD. |
| `report_schedules` | `id, company_id, template, def_id, title, cadence` (Daily/Weekly/Monthly)`, format, recipients text[], next_run, active, meta` — stored only. |

Bucket **`reports`** (private, 25 MB, PDF/CSV/XLSX), path `<company_id>/<run_id>.<ext>`, reports access only.

RPCs: `report_data(p_company, p_template, p_from, p_to, p_params)` (no log), `run_report(p_company, p_template, p_from, p_to, p_format, p_title, p_params, p_def)` (logs a run), `finish_report_run(p_run, p_path, p_error)`, `reports_overview(p_company)`.
Templates: `trip_performance`, `revenue_expense`, `vessel_util`, `incident_safety`, `passenger_move`, `crew_attendance`, `maint_history`, `route_compare`. Each returns `columns [{key, label, type}]` (type: text/date/time/number/money/percent) and `rows`, plus a `summary` for some.

### 3.13 Harbours & GPS arrival detection (0058)

How it works, settings and limitations: `supabase/ARRIVAL_DETECTION.md`. Tests: `supabase/tests/test_arrival_detection.py`.

**Tables**

| Table | Purpose | RLS |
|-------|---------|-----|
| `islands` | `id, company_id, name (unique per company), atoll, meta` | select members; write Operations |
| `harbours` | one row per terminal/jetty: `island_id, name (unique), code, lat, lng, geofence_type circle\|polygon, radius_m 20–3000, polygon [[lat,lng],…], approach_m, max_accuracy_m, dwell_sec, min_obs ≥ 2, allow_overlap, active, created_by/updated_by/at` | select members; write Operations. Trigger `hbr_guard` validates polygons and refuses overlapping active zones unless `allow_overlap` |
| `routes` + | `origin_harbour_id`, `destination_harbour_id` (must differ) | as routes |
| `trips` + | `origin_harbour_id`, `destination_harbour_id` — copied from the route on insert / route change (`trp_harbours_fill`); routes changing harbours update open trips (`rte_harbours_sync`) | as trips |
| `vessel_positions` | every raw fix: `source followme\|crew_device, device_ref (hashed), client_ref, observed_at, received_at, time_basis, lat, lng, accuracy_m, speed_kn, validity, zone, distance_m`; unique per (vessel, source, device, observed_at) and per client_ref | **no direct access** (read via `trip_arrival_detail`) |
| `trip_arrival_state` | one row per trip: `state` NOT_APPROACHING / APPROACHING_DESTINATION / ARRIVAL_PENDING / ARRIVED / TRACKING_UNAVAILABLE, `reason`, pending streak, last fix | select members |
| `trip_arrival_events` | the recorded arrival: `method gps_geofence\|crew_device_geofence\|manual\|manual_correction\|schedule_fallback, arrived_at, arrived_after, uncertainty_s, time_basis, confirmed_obs_at, obs_received_at, confirmed_at, lat, lng, accuracy_m, evidence, algorithm_version, reason, created_by, supersedes/superseded_at/by`. **Unique current event per trip.** | select members |
| `arrival_diagnostics` | detection log (ids/codes only): invalid_obs, geofence_enter/exit, tracking_gap, confirm_attempt, confirmed, duplicate, duplicate_prevented, persist_error, feed_error, not_configured, reopened | select Operations |

**RPCs (authenticated)**
- `ops_arrivals(p_company, p_day date default null)` → `{day, tz, now, trips:[{trip_id, code, status, route, origin, destination, origin_harbour, destination_harbour, vessel, depart_at, arrive_at, actual_arrive, state, label, reason, last_fix_at, last_received_at, fresh_s, distance_m, pending_count, method, arrived_at, arrived_after, uncertainty_s, confirmed_at, event_id, delta_min, local_arrival}]}`. Labels: Tracking / Approaching destination / Arrival pending / Arrived / Tracking unavailable / Harbour not set.
- `trip_arrival_detail(p_trip)` → `{trip, harbour, config, gps_managed, state, events, fixes (crew/Ops only), diagnostics (Ops only)}`.
- `correct_trip_arrival(p_trip, p_arrived_at, p_reason)` — Operations; supersedes the current arrival, audited.
- `ingest_vessel_position(p_trip, p_lat, p_lng, p_observed_at, p_accuracy_m, p_speed_mps, p_heading, p_device, p_client_ref)` — captain/crew of that trip only (crew phone tracking; no client sends it yet).
- `harbour_test_point(p_harbour, p_lat, p_lng, p_accuracy_m)`, `harbour_config_gaps(p_company)`, `arrival_cfg(p_company)`.
- `followme_fetch(p_vessel)` unchanged for the page (now a wrapper over internal `followme_fetch_core`).

**Internal (not granted):** `arrival_ingest`, `arrival_sweep`, `arrival_poll_followme`, `arrival_gps_managed`, `arrival_diag`, `followme_fetch_core`. Pure helpers: `geo_distance_m`, `geo_polygon_eval`, `harbour_reach_m`, `arrival_zone`, `arrival_check_obs`, `arrival_step`, `followme_pick`, `followme_position`, `followme_time`, `try_float`, `arrival_label`, `arrival_algorithm_version`.

**Replaced:** `ops_auto` (0045 + arrival sweep and GPS-aware arrival). **New triggers on trips:** `trp_harbours_fill` (before), `trp_arrival_sync` (after status change: records manual/clock arrivals, clears an arrival when a trip is reopened by hand).

**Setting:** `3_arrival_detection` (Operations may edit) — `enabled, assumedAccuracyM, maxDelaySec, maxFutureSec, maxGapSec, trackingGapSec, maxSpeedKn, passThroughKn, clockFallback, fallbackAfterMin, completeBookings, allowCrewDevices, retentionDays` (clamped by `arrival_cfg`).

**Arrival Lab (0059, platform owner only, read-only — writes nothing):**
- `arrival_simulate(p_harbour uuid, p_track jsonb, p_rules jsonb default '{}', p_start timestamptz default null)` — runs a track through `arrival_check_obs` → `arrival_step` exactly like `arrival_ingest`, without storing anything. `p_harbour` null = draft zone from `p_rules.harbour` {lat, lng, radius_m, …} with `p_rules.company` for settings. `p_track` = `[{lat, lng, t (s after p_start), accuracy_m|null, speed_kn, delay_s}]` (≤ 1000). `p_rules` = `{harbour: {radius_m, approach_m, max_accuracy_m, dwell_sec, min_obs, geofence_type, polygon}, cfg: {3_arrival_detection numeric keys}}`, clamped like the table / `arrival_cfg`. Returns `{version, harbour, cfg, tz, start, steps: [{i, observed_at, received_at, valid, reject, zone, distance_m, edge_m, accuracy_used, accuracy_assumed, event, state, reason, pending_count, dwell_s, tracking_gap_before, other_harbours}], final_state, final_reason, valid, rejected, arrival{arrived_at, arrived_after, uncertainty_s, confirmed_obs_at, first_obs_id, confirm_obs_id, fixes, dwell_s, local}}`.
- `arrival_lab_trips(p_company)` — up to 50 recent trips with stored fixes `{id, code, status, depart_at, arrive_at, actual_arrive, origin/destination_harbour_id, vessel, fixes}`.
- `arrival_lab_trip_track(p_trip)` — `{trip, start, event, track: [{lat, lng, t, accuracy_m, speed_kn, source, delay_s, live: {validity, zone}}]}`; replay with `arrival_simulate(dest, track, rules, start)`.
- Helper `arrival_lab_rules(h, cfg, rules)` (pure, clamps overrides).

**Autopilot — harbour learning (0060):**

| Table | Purpose | RLS |
|-------|---------|-----|
| `vessel_stops` | Where a vessel stayed within `stopRadiusM` for ≥ `stopMinSec` (centre, start/end, fixes, spread), with `harbour_id`, `arrive_trip_id/route_id`, `depart_trip_id/route_id` | select: `is_company_ops`; writes: learning only |
| `harbour_candidates` | Stops at no known harbour grouped within `mergeRadiusM`: stops, trip_stops, vessels, days, spread (p90), `name_guess`, status `learning / created / dismissed / conflict` | select: `is_company_ops` |
| `harbour_learning_log` | Every automatic change: `harbour_created`, `route_linked` (field, method `gps`/`name`), `candidate_conflict`; `undone_at/by` | select: `is_company_ops` |
| `harbour_learn_state` | Per company: `last_run_at`, `last_pos_id`, `summary` | select: `is_company_ops` |

RPCs (authenticated): `harbour_learning_status(p_company)` → `{cfg, last_run_at, summary, tracked_vessels, vessels, fixes_24h, stops_total, stops_at_harbours, routes_total, routes_complete, open_trips_without_harbour, candidates[{id, lat, lng, radius_m, stops, trip_stops, vessels, days, spread_m, name_guess, status, detail, last_seen, progress 0–1}], stops[{lat, lng, h, at, min}], log[{id, at, kind, detail, method, harbour_id, route_id, field, undone_at}]}` (ops) · `harbour_learn_now(p_company)` → run summary (ops) · `harbour_learning_undo(p_log)` (ops; harbour removed — or switched off when past trips use it — routes unlinked, spot dismissed) · `harbour_candidate_restore(p_candidate)` (ops; a dismissed spot may be learned again) · `harbour_learn_cfg(p_company)`.
Internal: `harbour_learn(company, now)`, `harbour_learn_stops`, `harbour_learn_all` (pg_cron `veyora_harbour_learn`, every 10 min), `learn_norm`. **Replaced:** `arrival_poll_followme` (also polls for learning).
Settings in `3_arrival_detection`: `autoLearn` (true), `autoLink` (true), `nameLinks` (true), `learnMinStops` (3), `learnMinDays` (2), `stopRadiusM` (80), `stopMinSec` (240), `mergeRadiusM` (150).

## 4. Settings key prefixes & `set_company_setting`

**Final ACL (0035):**

| Who | May set keys |
|-----|----------------|
| `is_company_admin` | **Any** valid key |
| `is_company_hr` | `8_%` and `16_%` |
| `is_company_it` | `13_%`, `14_%`, `17_%` |
| `is_company_maint` | `10_%` |
| `is_company_ops` | `3_%`, `4_%`, `5_%`, `6_%` (Operations, Routes & Locations, Schedule, Fleet) |

Category index ↔ UI (`settings-data.js` / `settings.js`):

| Prefix | Category title | Who (non-admin) |
|--------|----------------|-----------------|
| **`8_`** | HR & Crew Settings | HR |
| **`10_`** | Maintenance Settings | Maintenance (`is_company_maint` / operations + named) |
| **`13_`** | Security & Authentication | IT |
| **`14_`** | Integrations & Data Management | IT |
| **`16_`** | Agreements & Documents | HR |
| **`17_`** | IT Settings | IT |

**Example keys (slug of item title):**  
`8_attendance_rules`, `8_shift_definitions`, `8_duty_roster`, `8_crew_assignment_rules`, `8_leave_approval_workflow`, `8_approvers_and_responsibilities`, `8_payroll_configuration`, `8_allowance_rules`, `8_overtime_rules`, `8_crew_qualification_types`, `8_license_and_certificate_expiry_alerts`, …  
`10_maintenance_approval_rules`, `10_return_to_service_rules`, `10_work_order_number_format`, `10_maintenance_reminder_rules`, …  
`16_agreement_numbering`, …  
`17_device_management`, `17_mobile_check_in_and_check_out`, `17_alerts_and_notifications`, `17_it_asset_management`, `17_it_support_and_incident_management`, …

Also used elsewhere: `2_employee_id_format`, `2_reporting_managers`, `11_in_app_notifications` (owner/admin only unless admin).

---

## 5. Front-end query patterns (brief)

| Page / module | Tables / storage | Main RPCs |
|---------------|------------------|-----------|
| `shell.js` / `dashboard.js` | `companies`, `company_members`, `platform_admins`, `roster_entries`, `leave_requests`, `company_audit` | `platform_stats`, `company_subscription`, `it_network_status` |
| `platform.js` / `subscription.js` | `platform_settings`, `platform_audit` | `platform_*`, `redeem_code`, `request_renewal` |
| `company.js` / `invite.js` | `companies`, invites | `get_invite`, `accept_invite`; logos bucket |
| `settings.js` | `departments`, `job_titles`, `company_members`, `profiles`, `company_audit` | `set_company_setting`, `set_member_org`, `assign_employee_no`; logos |
| `hr.js` | members, certs, leave, attendance, corrections, docs, agreements, timesheets, payroll, `member_private`, `employee_events` | `refresh_attendance`, `clock_punch`+`punch_check`, leave/attendance/timesheet/payroll RPCs, `crew_availability`, `set_member_*`, `preview_allowances_all`; **`staff-documents`** |
| `roster.js` | `roster_entries`, `roster_periods`, members | `set_roster`, `publish_roster`, `set_roster_period_status`, `can_edit_roster` |
| `agreements.js` | `agreement_templates`, `agreements` | (direct table + storage **`agreements`** / logos) |
| `notifications.js` | `notifications` | `scan_hr_notifications`, `mark_notifications_read` |
| `it.js` | networks, devices, assets, tickets, notes, events, audit | `it_network_status`, `register_device`, `open_ticket`, `add_ticket_note`, `scan_it_assets` |
| `maintenance.js` | vessels → POs, stock, files | WO/defect/inspection/vessel/parts/PO RPCs; **`maintenance`** storage; `scan_maintenance` / `scan_low_stock` |
| `operations.js` | `trips`, `routes`, `vessels`, `trip_crew`, `trip_events`, `company_members`/`profiles`, `dispatch_tasks`, `ops_advisories` | `scan_operations`, `ops_board`, `schedule_trips`, `trip_manifest`, `clear_trip`, `set_trip_status`, `finish_dispatch_task`, `create_booking`, `cancel_booking`, `set_passenger_status`, `assign_trip_crew` — wired (§3.7–3.9) |
| `schedules.js` | `routes`, `schedule_templates`, `trips` | Fixed = weekdays + **multiple daily times** (one template row per `depart_time`, then `generate_trips`); promo/temp via `import_trips`; feed via `schedule_trips` |
| `passengers.js` | passengers, bookings, check-ins (planned) | empty shell — see Passengers UI section above |
| `finance.js` | `finance_summary`, `finance_entries`, `invoices` | DB ready (0046) — UI still to wire |
| `reports.js` | `reports_overview`, `run_report`, `finish_report_run`, bucket `reports` | DB ready (0047) — UI still to wire |
| `fleet.js` | `vessels`, `maint_schedules` | capacity / route / standby columns from 0035 |

Client always uses **`window.veyoraDb`** with the publishable key.

---

## 6. Migration file list (0001–0040)

**Live database status (checked 21 Oct 2026):** 0001–0040 are all applied to project `veyora` (pg_cron job `veyora_ops_tick` is scheduled); 0034–0040 were applied and probe-tested (in rolled-back blocks) on 21 Oct 2026. (0033's `scan_it_assets()` reminder dedupes on the date that triggered it — warranty or licence.)

1. **0001_init.sql** — companies, profiles, members, RLS helpers, logo bucket  
2. **0002_creator_can_read_company.sql** — creator can SELECT during INSERT RETURNING  
3. **0003_logo_select_policy.sql** — storage select for logos  
4. **0004_company_settings.sql** — company profile columns + `settings` jsonb  
5. **0005_staff_invites.sql** — invites, `active`, profile email, accept/get invite  
6. **0006_platform_owner.sql** — platform_admins, status guard, platform RPCs  
7. **0007_settings_store.sql** — company_audit, `set_company_setting`, platform config  
8. **0008_organization.sql** — departments, job_titles, org fields, `set_member_org`, employee numbers  
9. **0009_custom_roles.sql** — `role_label` on members/invites  
10. **0010_subscriptions.sql** — plans, trials, renew overlay, billing RPCs  
11. **0011_subscription_hardening.sql** — subscription field guard, random lifetime code, redeem rate limit  
12. **0012_platform_owner_access.sql** — platform admin treated as member/admin  
13. **0013_hr_crew.sql** — `is_company_hr`, duty/vessel, certs, leave, `decide_leave`, `set_member_hr`  
14. **0014_hr_settings.sql** — crew_group, HR may set `8_`, leave workflow, expired-cert rule  
15. **0015_hr_assign_designation.sql** — HR can set `job_title_id` via `set_member_hr`  
16. **0016_approvers.sql** — named leave approvers routing  
17. **0017_duty_roster.sql** — `roster_entries`, `set_roster`, `can_edit_roster`  
18. **0018_agreements.sql** — templates/agreements, `agreements` bucket, HR may set `16_`  
19. **0019_hr_notifications.sql** — notifications, scan, mark read  
20. **0020_roster_validation.sql** — periods, quals/rest/hours, publish  
21. **0021_attendance.sql** — attendance + corrections + clock/import RPCs  
22. **0022_staff_documents.sql** — documents bucket/versions; extends scan for doc expiry  
23. **0023_hr_foundation.sql** — employment status/dates, events, `crew_*`, HR org edits  
24. **0024_member_private.sql** — private contacts/status reason  
25. **0025_default_qualifications.sql** — default quals in roster/`crew_check`  
26. **0026_timesheets.sql** — weekly timesheets + approve/reopen  
27. **0027_payroll.sql** — member_pay, runs/lines, payroll RPCs  
28. **0028_allowance_rules.sql** — allowance engine + `preview_allowances`  
29. **0029_allowance_preview_all.sql** — `preview_allowances_all`  
30. **0030_it_department.sql** — IT role, networks/devices/assets/tickets, punch gate, IT settings ACL  
31. **0031_maintenance.sql** — vessels/WOs/defects/inspections, `maintenance` bucket, maint settings ACL  
32. **0032_spare_parts_purchasing.sql** — parts stock, PRs/POs, low-stock scan  
33. **0033_it_settings.sql** — ticket SLA from settings, device limits/alerts, `scan_it_assets`  
34. **0034_maintenance_costs_planning.sql** — job costs/estimates, budgets, contractors and technician skills, warranty claims, component lifecycle, vessel status history, `maint_report`, planning calendar with clash checks  
35. **0035_fleet_schedules.sql** — vessel capacity/route/standby/meta, `is_company_ops`, routes, schedule templates, trips + crew with clash rules, `schedule_trips` / `generate_trips` / `copy_trips` / `import_trips` / `set_trip_status`, maintenance planning blocked over trips, Operations may set `3_`/`4_`/`5_`/`6_` settings  
36. **0036_local_times.sql** — `local_time()`; trip and planning messages in company local time  
37. **0037_operations_dispatch.sql** — trip statuses from settings (`trip_closed`), trip numbers, dispatch clearance (`clear_trip`), `dispatch_tasks`, `ops_advisories` + `report_incident`, `trip_events`, `scan_operations`, `ops_board`  
38. **0038_bookings_passengers.sql** — passenger registry, bookings, booking passengers, seat counts, capacity / cut-off / required-info rules, refunds, manifest  
39. **0039_operations_automation.sql** — every-minute automation (`ops_tick` via pg_cron): trips ahead, crew from roster, boarding / departure / arrival by the clock, passenger boarding  
40. **0040_company_api.sql** — per-company API keys and `api_*` endpoints  
41. **0041_manual_delay_only.sql** — `ops_auto` never auto-sets Delayed; hold instead; Delay is manual via `set_trip_status` only  
42. **0042_roster_allow_absent.sql** — `roster_extra_block` no longer refuses working shifts for attendance Absent; On leave still blocked  
43. **0043_roster_documents_soft.sql** — `set_roster`: `8_crew_assignment_rules.expired` and `.qualified` now default **false** (expired licences/certificates, missing qualifications and the shift "For" group are warnings, not errors); existing companies set to false. Applied 22 Oct 2026 together with 0042.  
44. **0044_vessel_crew_mix.sql** — `vessels.meta.crew_mix [{role,n}]` (+ company default `3_auto_crew_rules.mix`), RPC `set_vessel_crew_mix(p_vessel, p_mix)` (ops or HR), `crew_mix(p_company, p_vessel)`, `member_fits_role`, `pick_crew_role`; `auto_assign_crew` rewritten (role mix, roster re-sync, `trips.meta.auto_captain`); `crew_check` expired/qualified default false.  
45. **0045_manual_delay_hold.sql** — `ops_auto` never auto-departs a hand-delayed trip; `auto_assign_crew` window includes held/delayed trips (6 h); old automatic "Waiting:" delays reset to Scheduled. (0041 applied at the same time.)  
46. **0046_finance.sql** — `finance_entries` ledger (auto from bookings, refunds, invoices, payroll, work orders), `invoices`, `finance_summary`, `record_invoice_payment`.  
47. **0047_reports.sql** — `report_runs`, `report_defs`, `report_schedules`, bucket `reports`, `report_data` / `run_report` / `finish_report_run` / `reports_overview`.  
48. **0048_trip_seats_follow_vessel.sql** — `trips_capacity` trigger (`trp_capacity`), `vessels_capacity_to_trips` (`ves_capacity_to_trips`), one-off seat sync.  
49. **0049_followme_fetch.sql** — `followme_links` (hidden), `followme_cache`, `followme_calls`, triggers `ves_followme_hide` / `ves_followme_after_insert`, `followme_fetch(p_vessel)` (1 call/company/min, 60 s cache, stale fallback), `followme_hint()`.  
50–54. See `supabase/migrations/` (0050 employee invite profile, 0051 owner full access, 0052 invites HR select, 0053 staff login, 0054 document templates).  
55–57. **Cursor, 26 Oct:** `0055_set_staff_name`, `0056_salary_bank`, `0057_invite_allowances` — used by `hr-add-employee.js` (set_staff_name, member_pay bank fields, apply_invite_profile). Restored into `beta/supabase/migrations/` on 28 Oct (from `_beta_stray_from_sync`). On `veyora` 0055 and 0056 were already applied; 0057 was missing and was applied 28 Oct.  
58. **0058_harbour_arrival_detection.sql** — `islands`, `harbours`, route/trip harbour ids, `vessel_positions`, `trip_arrival_state`, `trip_arrival_events`, `arrival_diagnostics`, arrival engine + FollowMe server poll, `ops_auto` replaced (GPS-aware arrival), `ops_arrivals` / `trip_arrival_detail` / `correct_trip_arrival` / `ingest_vessel_position` / `harbour_test_point` / `harbour_config_gaps`. See §3.13.  
59. **0059_arrival_lab.sql** — platform-owner Arrival Lab: `arrival_simulate`, `arrival_lab_trips`, `arrival_lab_trip_track`, `arrival_lab_rules`. Read-only. See §3.13.  
60. **0060_harbour_learning.sql** — Autopilot: `vessel_stops`, `harbour_candidates`, `harbour_learning_log`, `harbour_learn_state`; learning run every 10 min (pg_cron), auto harbours + route links with undo, `arrival_poll_followme` replaced. See §3.13.  
61. **0061_shift_swaps.sql** — shift swap requests (`shift_swaps`, `request/respond/decide/cancel_shift_swap`, `my_shift_swaps`, `swap_candidates`, `swap_rules`), `roster_apply` split out of `set_roster`; HR rule `8_shift_swap_rules`. See §3.3 Shift swaps.  
62. **0062_swap_designation.sql** — shift swap rule `scope` (Anyone / Same designation / Same crew group): `swap_candidates` filtered and `request_shift_swap` enforced; designation (job title) in candidates and requests.  
63. **0063_swap_default_designation.sql** — `swap_rules` default `scope` is now 'Same designation' (a crew member cannot swap with a captain); saved values are unchanged.  
64. **0064_ops_checkins.sql** — Operations check-in (`ops_checkins`, `ops_checkin` / `ops_checkout` / `my_ops_checkin` / `ops_checkins_recent`, rule `3_operations_check_in`); look-up mode in the apps; optional database enforcement on the booking and passenger actions. See §3.3 Operations check-in.  
65. **0065_attendance_breaks.sql** — Break in / Break out during a shift: table `attendance_breaks` (RLS: own rows and HR), `break_punch(p_company, p_kind 'in'|'out')`, `my_break_state(p_company)`; clocking out ends an open break (trigger). HR switches it on in Settings → Attendance Rules (`breaks`, `break_minutes`; 0 = no limit). See §3.3 Attendance breaks.
66. **0066_phone_positions.sql** — `share_vessel_position(p_company, p_lat, p_lng, p_observed_at, p_accuracy_m, p_speed_mps, p_heading, p_device, p_client_ref)` (only a person checked in to a vessel in Operations; feeds the arrival engine as `crew_device`, an estimate) and `vessel_live_positions(p_company, p_max_age_min default 360)` (Operations only; latest usable fix per vessel with `state` Underway / At port / Delayed / Restricted, `stale`, `source`, `trip`). See §3.13.
67. **0067_my_approvals.sql** — `my_approvals(p_company)` → `{comment_required, pending[], decided[]}` for the signed-in person (leave they may decide, shift swaps waiting for their approval, attendance corrections if HR) and what they decided in the last 30 days. Item `kind` is `leave`, `swap` or `attendance`. `leave_can_decide(id)` mirrors `decide_leave` (owner, named approvers, else the Leave Approval Workflow role). Decide with `decide_leave(p_id, p_approve, p_note)`, `decide_shift_swap(p_id, p_approve, p_note)`, `decide_attendance_correction(p_id, p_approve)`.
68. **0068_leave_self_service.sql** — `my_leave_overview(p_company)` → `{year, approval_on, weekend[dow], types[{name, days, paid, note, taken, pending, remaining}], requests[{id, type, start, end, days, status, note, decision_note}]}`; `request_leave(p_company, p_type, p_start, p_end, p_note)` → `{id, status, days}` (checks type, dates, weekend-only, note, yearly limit with approved + pending counted in the start year, overlap with your own leave; inserting fires the existing triggers, so approval-off auto-approves and approvers are notified); `cancel_leave(p_id)` (own, still pending). Working days skip the weekend from Duty Roster (`leave_weekend_dows`).
69. **0069_leave_certificates.sql** — `leave_requests.certificate boolean` (true with, false without, null = no rule or older request). Setting `8_leave_types_and_policies` rows gain `cert` (`Not applicable` default / `Optional` / `Required`), `nocert` (days a year that may be taken without a certificate; 0 = no separate limit) and `nocertRun` (longest stretch of working days without one; 0 = no limit); `days` stays the yearly total with or without. Trigger `leave_cert_rules` (before insert, so website and apps alike): Required needs `certificate = true`; Optional treats no answer as without, then checks `nocert` (approved + pending, by start year) and `nocertRun` (uncertified requests that run into each other across weekend days count as one stretch). `request_leave(..., p_certificate)`; `my_leave_overview` types add `cert, nocert, nocert_run, nocert_used, nocert_remaining`, requests add `certificate`; `my_approvals` leave items add `certificate`. Not built: attaching the certificate file (stored nowhere yet; the flag is what the person says).
70. **0070_leave_certificate_files.sql** — **Storage `leave-certificates`** (private, 10 MB; PDF, PNG, JPEG, WebP, HEIC). Path `{company_id}/{user_id}/{uuid}.{ext}`. Upload: only into your own folder as a company member. Read: the owner, HR, and the leave approvers of a request that uses the file (`leave_cert_can_read`). Delete: HR, or the owner while no request uses it. `leave_requests.certificate_path` / `certificate_name` (path must sit in the requester's own folder). Setting `8_leave_types_and_policies` rows gain `certFile` (boolean): a request with a certificate must carry the file. `request_leave(p_company, p_type, p_start, p_end, p_note, p_certificate, p_certificate_path, p_certificate_name)`, `attach_leave_certificate(p_id, p_path, p_name)`; `my_leave_overview` requests and `my_approvals` leave items return `certificate_name` / `certificate_path`; types return `cert_file`. Open a file with a signed link (`createSignedUrl`, 5 minutes). Staff can attach only to their own requests, so HR cannot upload for someone else.
71. **0071_app_notifications.sql** — `my_notifications(p_company, p_limit)` → `{unread, items[{id, kind, stage, title, body, subject_type, subject_id, read, created_at}]}` (own rows only); `mark_all_notifications_read(p_company)`; `mark_notifications_read(p_ids uuid[])` already existed. New notice kinds: `new_booking` (Operations + the trip's captain, not the person who made it; written at commit so the passenger count is right), `passenger_added` (a passenger added to a booking more than 2 minutes after it was made), `booking_cancelled` (with the reason), `attendance_correction` (to HR) and `attendance_decision` (to the person). Push groundwork: table `push_devices` (own rows readable; `register_push_device(p_platform, p_token, p_environment, p_device, p_version)`, `unregister_push_device(p_token)`), table `push_outbox` (service role only; a trigger on `notifications` queues a row for anyone with a registered device) and the edge function `supabase/functions/send-push` (APNs and FCM; **untested**, needs `PUSH_SECRET`, `APNS_*`, `FCM_SERVICE_ACCOUNT` secrets and a database webhook on `push_outbox` insert). Adds `notifications` to the `supabase_realtime` publication so the apps get new rows over a live connection (row security applies; the apps ask for their own `user_id` only). Also re-creates `update_booking_passengers` with the `fare` column qualified: the 0038 and 0064 versions failed on every call with "column reference fare is ambiguous".
72. **0072_leave_status_trail.sql** — `leave_trail(p_id)` → `{status, steps[{state: done|waiting|approved|rejected, title, name, no (employee number), at, note}]}` for one leave request: Submitted, then who it is waiting for (named approvers, else the role team) or who decided it with date and note ("Approved automatically" when approval is off). Readable by the requester, HR and routed approvers. Read-only. Used by the apps' leave detail sheet.
73. **0073_leave_routes_by_department.sql** — **applied on `veyora` 29 Oct.** `leave_approver_ids` now matches `All staff` and `Dept:<uuid>` routes only (crew group = department); existing `Group:<crew group>` routes in `8_approvers_and_responsibilities.leave.routes` are rewritten to one `Dept:<uuid>` route per department that has job titles in that group (a department that already has a rule keeps it; a group with no department is dropped). Test: `tests/test_leave_routes_by_department.py`.
74. **0074_live_position_broadcast.sql** — **applied on `veyora` 29 Oct.** Trigger function `broadcast_vessel_position()` (after insert on `vessel_positions`) calls `realtime.send` with `{vessel_id, lat, lng, heading, speed_kn, accuracy_m, source, at}`, event `position`, private topic `vessel-pos:<company id>`; policy `vessel_pos_listen` on `realtime.messages` lets only `is_company_ops(company)` listen. Best effort; never blocks an insert.
75. **0075_land_filter.sql** — **applied on `veyora` 29 Oct** (with `seed/maldives_land_masses_1..4.sql`: 1310 islands, 28253 points). Table `land_masses(id, min_lat, max_lat, min_lng, max_lng, ring jsonb [[lat,lng],…])` (RLS on, no policies; reference data from `seed/maldives_land_masses_*.sql`); `fix_on_land(company, lat, lng, margin_m default 15)` (security definer, not callable by clients): true when inside an island by more than the margin and not inside one of the company's active harbour zones; `vessel_positions.on_land boolean` set by BEFORE INSERT trigger `vpos_land`; `broadcast_vessel_position()` skips land fixes; `vessel_live_positions` lists the newest fix that is not on land and adds `held` (newest fix is on land) and `live_age_s`. Company setting `3_vessel_map` `{holdOnLand: boolean}` (default true) turns the rule off. Test: `tests/test_land_filter.py`.
76. **0076_trip_staff_notifications.sql** — **applied on `veyora` 29 Oct.** `trip_staff_ids(trip)` (captain + `trip_crew`, active members) and `trip_notice_audience(company, trip)` (those people, or `ops_user_ids` when nobody is assigned); `booking_notify`, `booking_pax_notify` and `booking_cancel_notify` now use it instead of Operations + captain. Both helpers are internal (no client grants). Test: `tests/test_trip_staff_notifications.py`.
77. **0077_notification_recipients.sql** — **applied on `veyora` 29 Oct.** `trip_notice_audience(company, trip, kind)` (three arguments; replaces the 0076 two-argument one, internal) builds the audience from company setting `3_booking_notice_recipients` → `{new_booking|passenger_added|booking_cancelled: {designations: [job titles], rosteredOnly (default true: roster_entries on the trip's local departure day, shift not OFF/L), tripStaff (default true: captain + trip_crew), operations (default false)}}`; members with `assigned_vessel` set count only for that vessel (name or code); empty audience → `ops_user_ids`. `booking_notify`, `booking_pax_notify`, `booking_cancel_notify` call it with their kind. Settings key `3_` is written by owners/admins. Superseded by 0078 (its setting is converted there).
78. **0078_notice_types.sql** — **applied on `veyora` 29 Oct.** Company setting `11_notice_types` = `{<kind>: {enabled (default true), keepDefault (true), teams ['operations'|'hr'|'it'|'maintenance'], designations [job titles], rosteredOnly (true)}}`. `notify_user` returns false when the kind is disabled, skips the default recipient when `keepDefault` is false and adds the extras; `notify_many` does the same for its list and adds the extras once (session flag `veyora.notice_busy`). New internal helpers: `notice_cfg`, `notice_trip_of(subject_type, subject_id)`, `notice_insert`, `notice_extras` (designations: active holders of the job title; roster_entries on the trip's local departure day or today, shift not OFF/L; a person with `assigned_vessel` only for that vessel's trips; teams via `ops_/hr_/it_/maint_user_ids`; never `auth.uid()`). `trip_notice_audience` is back to the default (trip captain + `trip_crew`, else Operations). The saved `3_booking_notice_recipients` is converted (tripStaff false → keepDefault false; operations true → team operations) and removed. Kinds: new_booking, passenger_added, booking_cancelled, trip, ops_advisory, leave_request, leave_decision, leave_reminder, attendance_correction, attendance_decision, swap_request, swap_approval, swap_result, cert_expiry, document_expiry, payslip, work_order, maint_plan, defect, vessel_status, maint_due, maint_warranty, maint_contract, maint_budget, low_stock, purchase_request, purchase_order, it_device, it_alert, it_ticket, it_ticket_reply, it_ticket_assigned, it_ticket_done. Test: `tests/test_notice_types.py`.
79. **0079_notice_safeguards.sql** — **applied on `veyora` 29 Oct.** `notice_kinds()` (the 33 known kinds), `notice_required(kind)` (leave_decision, attendance_decision, payslip, swap_request, swap_result, it_ticket_reply, it_ticket_assigned, it_ticket_done: always sent to the person), `notice_cfg` now forces `enabled` and `keepDefault` true for those (extras still allowed); `set_notice_type(p_company, p_kind, p_cfg jsonb) returns jsonb` (security definer, `is_company_admin`, rejects unknown kinds, keeps only known teams and non-empty designations, forces the personal-kind flags, writes `company_audit` action `notice_changed` with a readable change summary, `p_cfg` null = reset to default). The settings pages call this function instead of writing `11_notice_types` directly. Test: `tests/test_notice_types.py` (25 checks).
80. **0080_quick_add_passengers.sql** — **applied on `veyora` 30 Oct** (verified live with a rolled-back test add). `booking_create_core` is re-created with one change: when the transaction-local setting `veyora.quick_add` is `'1'` (set only inside the two functions below, never from a request) and the booking is a staff booking, the required passenger information is just full name + phone instead of company setting `7_required_passenger_information`. New: `quick_add_passengers(p_company, p_trip, p_name, p_phone, p_seats default 1) returns jsonb` (any company member; name ≥ 2 characters, phone ≥ 6 digits, seats 1–20; booking source Manual, status Confirmed, `meta {quick, seats}`; passengers: lead = name, others `name (guest N)`, category Adult, phone on every row; capacity, cut-off and closed-trip rules of `booking_create_core` still apply) and `create_booking_quick(p_company, p_trip, p_booking, p_passengers)` (same as `create_booking` with the relaxed rule; used by the website's Operations Add passenger form). Returns `booking_json`. Test: `tests/test_quick_add_passengers.py` (17 checks).
81. **0081_accept_invite_fix.sql** — **applied on `veyora` 29 Oct** (verified live with a rolled-back accept). `accept_invite(p_token)` is re-created with the variable `settings` renamed `v_settings`: the 0050 version failed with `42702 column reference "settings" is ambiguous` on every call, so invited people got a login but were never added to the company (employee stayed "Invite sent", a second try said "User already registered"). Logic unchanged.
82. **0082_staff_photos.sql** — **applied on `veyora` 31 Oct** (verified live with a rolled-back check: path saved, wrong folder and unknown person rejected, 4 storage policies, private bucket). Staff photos. New column `company_members.photo_path` (text, path inside the bucket) and private storage bucket `staff-photos` (5 MB; jpeg/png/webp; path `{company_id}/{user_id}/{file}`). Storage policies: read = any company member; insert/update/delete = HR (`is_company_hr`) or the person for their own folder. New RPC `set_staff_photo(p_company, p_user, p_path)` (HR or self; path must start `{company}/{user}/`; null clears; writes `company_audit` `staff_photo_changed`). Clients upload the file, call the RPC, delete the old file, and show the photo through a signed link (`createSignedUrl` / `storage/v1/object/sign/staff-photos/<path>`); `company_members` is already readable by members, so `photo_path` comes with the member rows.

---

## 7. Explicit DO NOT (for Claude / DB work)

1. **Never put `service_role` (or any secret key) in front-end, `config.js`, committed samples, or client-side docs meant for the browser.** Only URL + anon/publishable key.  
2. **Do not invent tables, columns, RPCs, enums, or buckets in the app without a new numbered migration** under `supabase/migrations/`. Update this handoff when you add one.  
3. **Apply migrations strictly in order 0001 → 0071**. Never skip or re-order.  
4. Prefer **RPCs (security definer) + RLS** for privileged writes; do not weaken RLS to “make the UI work.”  
5. Do not let company admins mutate **subscription** fields directly — only platform / subscription RPCs with `veyora.subscription_write`.  
6. Do not change **company `status`** except as platform admin / guard.  
7. Settings keys must stay **`^[a-z0-9_]{1,60}$`** and respect **prefix ACL** in `set_company_setting`.  
8. Stock and many HR/IT/maint workflows **must stay RPC-only** (no broad INSERT policies).  
9. Cursor owns UI; if UI needs a new query shape, add/adjust DB objects via migration first, then tell Cursor the exact names.

---

## Quick reference: storage buckets

| Bucket | Public? | Path convention |
|--------|---------|-----------------|
| `company-logos` | yes | `{company_id}/...` |
| `agreements` | no | `{company_id}/templates/...` or `{company_id}/{agreement_id}/...` |
| `staff-documents` | no | company + user segments (helpers `staff_doc_file_*`) |
| `maintenance` | no | company-prefixed (`maint_file_company`) |

---

*Generated from migrations 0001–0040, `supabase/README.md`, `config.js` / `db.js`, and front-end `.from` / `.rpc` / `storage.from` usage.*
