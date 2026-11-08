## 2026-11-01 — Claude: new passenger card on the Operations trip Passengers tab
- Owner sent a mockup; `paxCard()` in `operations.js` now draws it (new `.pxc-*` styles at the end of `operations.css`; the old `.plx-card` styles are unused by the card but left in place).
- Card: gradient initials tile, upper-case name + category, phone / "ID -" with a copy button (copies the ID, else phone, else booking ref), chips for booking ref, seats on this line (`meta.seats`, from 0084) and source; status + payment pills; violet "Seat: N" panel ("—" grey when no seat); Booked → Checked in → Boarded progress bar; Payment footer ("Amounts in MVR"), method dropdown, Mark paid, **Boarded** (now offered straight from Booked, as in the mockup) and Cancel.
- Same handlers as before (`set_passenger_status`, `update_booking` via `markBookingPaid`, `cancel_booking`); new `[data-copy]` handler in `bindTrip`. No database change. Cache versions bumped in `operations.html` (`20261101p1`).
- Checked: rendered from the real `paxCard` code with sample passengers in Edge at desktop and phone width; `operations.js` parses. Not yet clicked through on the live page. If a company requires check-in before boarding (`ops_require_checkin`), Boarded on a Booked passenger will be refused by the database with its message.

## 2026-10-30 — Claude: mobile "Your week" shows rostered shifts without saved Shift Definitions
- Cause: a company that never saved `8_shift_definitions` showed every rostered day as "No shift" in both apps (the web and the database fall back to D 06–14, E 14–22, N 22–06; the apps used an empty list).
- iOS `beta-ios/beta-ios/HomeData.swift`: `ShiftDef.defaults` (same three shifts/colours) used when the setting is missing.
- Android `beta android/.../Models.kt`: `ShiftDef.defaults`; `RosterLoader.parseDefs` returns them when the setting is missing.
- A saved Shift Definitions list is still used as-is. Not compiled here (no Xcode / Android SDK on this PC) — rebuild both apps.

## 2026-10-30 — Claude: "map data not available" when zooming the Operations map (fixed)
- Cause: the free Esri satellite imagery only has real tiles up to zoom 17 around Thulusdhoo (zoom 18 and 19 return Esri's small "Map data not yet available" tile; Malé goes to 19). The maps asked for zoom 18/19 anyway.
- Fix: `maxNativeZoom: 17` on the satellite layer (and 16 on the place-name labels) in `operations.js` (Live Vessel Map), `arrivals.js` (harbour editors) and `arrival-lab.js`, so past that zoom Leaflet enlarges the last real tile instead of requesting missing ones. Checked: zooming the Live Vessel Map all the way in only requests zoom 17 imagery and zoom 16 labels, no placeholder tiles. The Map (OpenStreetMap) view was not affected. Imagery is blurrier past zoom 17, which is all that exists there.

## 2026-10-30 — Claude: no check-in, Board asks for payment first (apps; built, not run)
- iPhone (`BoardSheet.swift`, `OperationsTripsView.swift`, `PassengerDetailView.swift`, `HomeData.swift`) and Android (`BoardSheet.kt`, `OpsScreens.kt`, `PassengerDetail.kt`, `AppViewModel.kt`): the Check in step is gone (statuses Booked -> Boarded; filter chip, tile, journey step and detail buttons removed). Board on a paid booking boards at once; on an unpaid booking it opens a popup: collect now (on/off), payment method, currency (Finance -> Supported Currencies, base first), amount received, "counted as" in the base currency when the currency differs, optional "also board the rest of this booking". Saves with `update_booking` (paid_amount, payment_method, meta.payment) then `set_passenger_status` Boarded. No database change.
- Status: iPhone builds, Android compiles. NOT yet seen running: the simulator crashed in dyld on launch (simulator problem, restarted); needs a look on the simulator or a phone. The website's check-in/boarding controls are unchanged.

## 2026-10-30 — Claude: add passengers from the phone apps, trip first (applied)
- Found: the website's Operations page already has Add passenger (trip, name, phone required, seats); the phone apps had none. Also, with the company's default "ID required" rule, a name + phone only add is refused by the database.
- Migration `supabase/migrations/0080_quick_add_passengers.sql` (not applied): `quick_add_passengers` and `create_booking_quick`; relaxed rule only through a transaction-local flag inside them. Test `supabase/tests/test_quick_add_passengers.py` 17/17.
- iPhone: new `AddPassengerSheet.swift`, "person +" button in the Operations header (`OperationsTripsView.swift`); step 1 choose a trip (open trips of the shown day with seats left, full ones disabled), step 2 name, phone (required, at least 6 digits), seats stepper (limited to seats left, max 20), success screen with "Add another to this trip". Not checked-in = the button opens the check-in sheet first. Built and opened on the simulator (trip list and form checked; nothing saved).
- Android: `AddPassenger.kt` (same flow as a bottom sheet) and a PersonAdd button in the Operations header (`OpsScreens.kt`); compiles, not run.
- Website: the Operations Add passenger form now calls `create_booking_quick` (`operations.js`), so name + phone is enough there too. Seats were chosen over "number of passengers": it is what the trip capacity counts, and each seat becomes a passenger row for check-in and boarding.
- **Applied on `veyora` 30 Oct** after "Apply 0080" (file hash `5ec9c090…00e3eaed`); the SQL editor showed "Success. No rows returned". Verified live right after (a script that rolls itself back, run as the Coral Line owner on the next open trip): both functions exist; a quick add of 3 seats made 3 passengers ("ZZ Verify Test", "(guest 2)", "(guest 3)", ref BK-2026-000045 — rolled back, not saved); `create_booking_quick` made 1; a normal booking without an ID was still refused ("Passenger 1: add ID / passport number"). Not yet tried from the phone app itself.

## 2026-10-29 — Claude: notice safeguards (applied)
- Answer to "a notice turned off stays off for the person it is about": personal notices are locked, the rest keep their switch behind a confirmation.
- Migration `supabase/migrations/0079_notice_safeguards.sql` (not applied): `notice_required` list (8 personal kinds) forced on inside `notice_cfg`, so the person is always told even if a setting says off; `set_notice_type()` is the only way the pages save (admin only, cleaned shape, audit entry `notice_changed`, null = reset). Test `supabase/tests/test_notice_types.py` 25/25 (an old check was changed: a personal notice can no longer be dropped).
- Settings pages (`settings.js`, `notice-types.js`, `settings.css`): personal sections show an "Always on" lock instead of the two switches; turning a team or safety notice off (or dropping everyone) asks first, in red for safety notices; "Reset to default" button; list tags now read Default / Custom / Off; new first section **Notice Overview** (table of all 33 notices with status and who gets each, filters, recent changes from the audit log). Checked in the browser: overview, locked section, red confirm panel; nothing was saved.
- **Applied on `veyora` 29 Oct** after "Apply 0079" (hash `8d1385f6…d16b2f19`; no warning prompt). Checked live: `notice_kinds()` has 33, `notice_required('payslip')` is true and `new_booking` false, the Cashier designation is still read for new bookings. Through the website session: re-saving New Booking worked and was audited, an unknown notice was refused ("Unknown notice type."), a payslip save with everything off came back forced to enabled + keepDefault (then reset to default; both logged). The pages save through `set_notice_type`.

## 2026-10-29 — Claude: a settings section for every notification type (applied)
- Owner asked that every type of notification gets its own settings section. There are 33 kinds (bookings, trips, leave, attendance, shift swaps, HR documents, payroll, maintenance, IT), all sent through `notify_user` / `notify_many`, so the rule is central.
- Settings: new group **Notice Types** (Settings → Notice Types, 33 sections, catalogue in `notice-types.js`; editor is the `notice-type` hook in `settings.js`; the old "Booking Notice Recipients" editor is gone). Each section: send this notice on/off, keep or drop the normal recipients, also tell teams (Operations, HR, IT, Maintenance) and designations (job titles), designations only if on the roster that day.
- Migration `supabase/migrations/0078_notice_types.sql` (not applied): setting `11_notice_types`, rule inside `notify_user` / `notify_many`, helpers `notice_cfg` / `notice_trip_of` / `notice_insert` / `notice_extras`, booking audience back to default, and conversion of the saved 0077 Cashier setting. Test `supabase/tests/test_notice_types.py` 17/17 (default, team, designation + roster + vessel rules, keepDefault off, disabled, personal notices, conversion). The superseded 0077 test was removed.
- **Applied on `veyora` 29 Oct** after "Apply 0078" (hash `d9365a0b…c5e891cb`; no warning prompt this time). Checked live: the four helpers exist, `notify_many` calls `notice_extras`, the Coral Line Ferries (Test) Cashier setting was converted to `11_notice_types` for the three booking notices (Cashier, rosteredOnly on, default recipients kept) and `3_booking_notice_recipients` is gone; the New Booking Notice page shows Cashier selected.

## 2026-10-29 — Claude: booking notices by designation (applied)
- Owner asked for cashiers (or a setting by designation) instead of crew. Built the setting: Operations Settings → **Booking Notice Recipients** (`3_booking_notice_recipients`), one card per notice (New booking, Passenger added, Booking cancelled): pick designations (job titles), switch "only people on the duty roster that day", "the trip's captain and assigned crew" and "everyone in Operations". Editor is the new `notify-recipients` hook in `settings.js` (styles `.nr-*` in `settings.css`; def/data/help entries added).
- Migration `supabase/migrations/0077_notification_recipients.sql` (not applied): `trip_notice_audience(company, trip, kind)` reads that setting; roster check uses the trip's local departure day (shift not OFF/L); a person with an assigned vessel counts only for that vessel's trips; Operations is the fallback. Test `supabase/tests/test_notification_recipients.py` 13/13 (it caught a variable-name clash that would have broken the function).
- **Applied on `veyora` 29 Oct** after "Apply and set Cashier": migration 0077 together with the Coral Line Ferries (Test) setting (combined script hash `651d764e…9899a431`; Supabase's destructive-operations prompt appeared because of `drop function` for the old two-argument version): all three notices → designation Cashier, rosteredOnly on, tripStaff on, operations off. Checked live: only the three-argument `trip_notice_audience` exists; a dry run for the next three open trips returns Aminath Leena (a cashier on the roster) for each.

## 2026-10-29 — Claude: booking notices go to the staff on the trip (applied)
- Cause: new booking / passenger added / cancellation notices went to Operations and the trip's captain only (0071), so crew rostered on a trip (`trip_crew`) never received them.
- `supabase/migrations/0076_trip_staff_notifications.sql` (not applied): recipients are now the trip's captain and `trip_crew` members (active), minus the person who made the change; Operations is told only when nobody is assigned to the trip. Push goes with it (every notification row is queued for push). Test `supabase/tests/test_trip_staff_notifications.py` 11/11.
- **Applied on `veyora` 29 Oct** after "Apply 0076" (hash `d32cba7e…0b8b5d6b`; no warning prompt). Checked live: both helper functions exist; of 330 open trips only 13 have anyone assigned (captain or crew), so for the other trips Operations still gets the notice until crew are assigned (auto-assign fills trips departing within 48 h, Operations Settings → Auto Crew Rules).
- No app change: both apps and the website already show any notification addressed to the person.
- Limits: crew assigned after a booking was made are not told about earlier bookings; Operations no longer gets these notices for trips that have staff assigned.

## 2026-10-29 — Claude: land/sea check for vessel positions (applied)
- Data: Maldives coastline from the OpenStreetMap Overpass API (natural=coastline, bbox -0.8..7.2, 72.5..73.9; 1346 closed outlines), islands under 900 m² dropped (a phone can never be 15 m inside them), simplified to about 5 m: 1310 islands, 28k points, saved as `supabase/seed/maldives_land_masses_1.sql` … `_4.sql` (4 files of about 150 KB).
- Migration `0075_land_filter.sql` (not applied): `land_masses`, `fix_on_land()`, `vessel_positions.on_land` + trigger, no broadcast for land fixes, `vessel_live_positions` holds the last sea fix (`held`). Uses the existing `geo_polygon_eval` (no PostGIS). Test `supabase/tests/test_land_filter.py` passes (real island data: inside = land, open sea = sea, 5 m from the shore = sea, harbour zone = sea, held position, setting off).
- Website: popup says "Phone is on land: showing the last position at sea"; held boats show amber (idle); new Operations setting "Vessel Map" (`3_vessel_map`, "keep the vessel at its last position at sea when a phone is on land", default on) in `settings-defs.js` / `settings-data.js` / `settings-help.js`.
- **Applied on `veyora` 29 Oct** after the owner said "Apply it": migration 0075 (hash `00f617a1…9af10ff2`), then the four island files one by one; counts checked (1310 islands, 28253 points, 2 triggers). Live check: the test phone spot on Thulusdhoo (4.37277, 73.6536) is land, open sea (4.30, 73.30) is not. Old positions were not re-checked, so Tharika Express 4 still shows at its last stored position until the phone sends a new fix on land.
- Effect to know: a vessel whose phone has only ever been on land (like the current test phone on Thulusdhoo) disappears from the map until it reports from the water, or the setting is turned off.

## 2026-10-29 — Claude: iPhone blue location pill turned off
- `PositionSharer` now sets `showsBackgroundLocationIndicator = false`, so the blue pill in the Dynamic Island / status bar no longer shows while position sharing runs in the background. iOS still shows its small location arrow in the status bar while any app uses location; apps cannot hide that.

## 2026-10-29 — Claude: live boat feed (pending migration 0074) and faster phones
- Found: heading does reach the database and the map boat does turn (it showed 218° from the newest fix), but the owner's phone only sent a position every 2 minutes (older build), and the grey "stopped" boat hid its heading cone.
- Migration `supabase/migrations/0074_live_position_broadcast.sql` — **applied on `veyora` 29 Oct** after the owner said "Apply 0074" (hash `554da378…31ca7284`; Supabase's "destructive operations" prompt appears because of the `drop trigger/policy if exists` lines, which only touch the objects this migration creates). Checked live: the website joins the private channel and shows "Live · instant"; a one-off `realtime.send` from the SQL editor turned the boat from 350° to 90° within seconds. Trigger `vpos_broadcast` sends every stored fix to the private Realtime channel `vessel-pos:<company id>`; policy limits listening to Operations. Test: `supabase/tests/test_live_position_broadcast.py` (1/1 with a stubbed `realtime.send`).
- Website `operations.js`: subscribes to that channel and moves the boat on every fix; the 3 s read stays as a fallback (15 s while the channel is connected); label reads "Live · instant" when connected. `vessel-markers.css`: stopped boats now show the heading cone too.
- Phones (iPhone `PositionSharing.swift`, Android `AppViewModel.kt`): a fix is queued as soon as the phone moves 3 m or turns 6° (at most once a second), and at least every 15 s; the compass reading is stamped with the current time when the GPS reading is under 15 s old. Both apps need reinstalling to pick this up.

## 2026-10-29 — Claude: Operations map follows vessels live
- Website: the Live Vessel Map reads `vessel_live_positions` every 3 s (one read at a time, paused while the browser tab is hidden, refreshed when it comes back), and `vessel-markers.js` glides each boat to its new position over about a second and turns it the short way round. A green "Live · N vessels" label sits beside the map style buttons.
- Phones send a position about every 5 s while moving and every 15 s when still (was 30 s / 2 min): iPhone `PositionSharing.swift`, Android `AppViewModel.kt`. Server unchanged: no rate limit on `share_vessel_position`.
- This is fast polling, not a push channel: raw position rows are not readable by clients (by design), so Supabase Realtime cannot stream them. Delay is about the phone interval plus up to 3 s. If many Operations users watch the map at once, a database broadcast could replace polling.

## 2026-10-29 — Claude: position sharing keeps going in the background
- iPhone: project gets `Info-extra.plist (UIBackgroundModes = location)`; `PositionSharer` sets `allowsBackgroundLocationUpdates`, `showsBackgroundLocationIndicator` (iOS blue pill), `pausesLocationUpdatesAutomatically = false`. Still runs only while a vessel check-in is open (stop() turns it off). Works with "While Using the App" permission once sharing was started in the foreground.
- Android: new foreground service `PositionShareService` (type `location`, permission `FOREGROUND_SERVICE_LOCATION`, notification "Sharing vessel position"), started and stopped by `AppViewModel` with position sharing, so GPS reading and sending continue with the app in the background or the screen off.
- Not tested on real phones. Limits: if the app is force-quit (iPhone) or the phone maker's battery saver kills it (Android), sharing stops until the app is opened again.

## 2026-10-29 — Claude: boat tip follows the phone's direction
- The vessel position a phone shares now carries the direction it points: while moving (over 1 m/s) the GPS direction of travel, otherwise the compass heading (iPhone `PositionSharing.swift` uses `CLLocationManager` heading; Android `Location.kt` uses the rotation-vector sensor, `AppViewModel.kt` picks travel direction, then compass). The server already stored `heading` (`share_vessel_position` → `arrival_ingest`) and `vessel_live_positions` returns it, so the website boat marker rotates with no web or database change. iPhone built, Android compiles; not tested on real phones.
- Caveat: the compass is where the phone points, so it matches the boat only when the phone is held or placed lined up with the vessel. Magnetometer needs a real device (the simulator has none).

## 2026-10-29 — Claude: Migration 0073 applied; Coral Line leave routes by department
- Applied `0073_leave_routes_by_department.sql` on `veyora` (pasted with the combined script hash `7ae52b3a…02204674`). Then set the Coral Line Ferries (Test) routes (company data, chosen by the owner, option 3): Operations → Leena; Marine → Deck approver, Engineering approver and Leena; HR & Admin → Leena; All staff → Leena. Coral Line had no Marine department (the MARINE departments seen earlier belong to other companies), so an empty **Marine** department was created to hold the Deck and Engineering approvers; move people into it or reuse it as needed.
- Effect: Cashiers, Captains, crew and the Operations Manager (all in Operations) now go to Leena only; the old Deck approver and Engineering approver only apply to people placed in Marine.

## 2026-10-29 — Claude: wrap-up pass
- Trip Tracking tab map now uses the same boat marker (offline when the FollowMe signal is stale). The phone apps have no vessel map (only the Location test map with the user dot), so nothing to mirror there.
- Leave status sheet in both apps: when several approvers are listed, each waiting step reads "Waiting for approval · any one of N can approve" (iPhone built, Android compiles).
- 0073 documented in `supabase/README.md` and `DATABASE_HANDOFF.md` as not applied.

## 2026-10-29 — Claude: Boat markers on the Operations Live Vessel Map
- New `vessel-markers.js` + `vessel-markers.css` (scoped `.vsl`): top-down SVG speedboat, status ring, heading cone, label when selected, offline badge. One Leaflet marker per vessel id, updated in place; boat rotated by CSS (the map never rotates it); size follows zoom (16–64 px, selected larger); unique SVG gradient ids per marker; only the boat itself takes clicks, so dragging and zooming the map are not blocked. `operations.js` feeds it from the existing `vessel_live_positions` data (vessel_id, lat, lng, heading, state, stale) every 30 s; removed vessels are removed from the map and everything is cleaned up with the map. Status: stale = offline (red), Underway or speed ≥ 1 kn = moving (blue), Delayed/Restricted = idle (amber), else stopped (grey). Legend now reads Moving / Stopped / Idle / Offline. No new library, no database change.
- The trip "Tracking" tab map still uses its own small arrow marker.

## 2026-10-29 — Claude: iPhone location never asked for permission (fixed)
- Cause: the iPhone app had no `NSLocationWhenInUseUsageDescription` (location usage text), so iOS never showed the "Allow location" prompt on a real phone and every location call (Home check-in, Operations check-in, vessel position sharing, Location test) saw "not determined" and returned nothing. Added `INFOPLIST_KEY_NSLocationWhenInUseUsageDescription` to both build configurations in `beta-ios.xcodeproj/project.pbxproj`; the built app's Info.plist has it and the prompt now appears after a permission reset on the simulator.
- Android already declares `ACCESS_FINE_LOCATION` / `ACCESS_COARSE_LOCATION`; no change.

## 2026-10-29 — Claude: Test payslips for Nisha (live veyora data)
- Inserted two test pay runs for Coral Line Ferries (Test) with a line for Nisha: September 2026 (Paid, net 8,860.00) and October 2026 (Approved, net 9,193.33). Both runs have note `TEST payslip run (safe to delete)`; delete them from HR → Payroll & Overtime or with `delete from payroll_runs where note = 'TEST payslip run (safe to delete)'` (lines go with them).
- Seen on the iPhone: hero card, totals, list and detail sheet all show correctly. Small fixes after seeing it: readable status tag on the hero card, year (not "26") on the date tile, minus sign before negative amounts. Mirrored in `Payroll.kt`; Android compiles.

## 2026-10-29 — Claude: Payroll page in the phone apps (Menu → Payroll)
- iPhone `PayrollView.swift` (+ Menu link in `MainTabView.swift`), Android `Payroll.kt` (+ `Route.Payroll` and a Menu row in `MainActivity.kt`). Own payslips only, read from `payroll_lines` joined to `payroll_runs` (status Approved or Paid; RLS already limits it to the signed-in person). Latest-payslip hero card, year chips, Earned/Deducted/Take-home totals, payslip list, detail sheet with earnings, allowance items, overtime, deductions. Refreshes with the live tick. No database change.
- iPhone built and launched; the empty state was checked with the test login (no approved pay run yet). Android compiles; not run on a device.

## 2026-10-29 — Claude: HR Settings hub (hr.html#settings)
- New `hr-settings.js` + `.hs-*` styles in `hr.css`; `hr.js` gets a `settings` section (`mountHrSettings`), `shell.js` "HR Settings" now opens `hr.html#settings`. Groups: People & records, Shifts & attendance, Leave, Pay & overtime, Crew & certificates, Approvals & responsibilities. Overview has stats, live search and cards with Customised/Default status; each setting opens in place (`#settings/<group>/<item>`) using the same editors and the same `8_` keys, so no database change.
- Items that need the Settings page's own editors (Employee ID Format, Staff Categories, Employment Types) open there; allowance rules, allowances, departments and leave open their HR pages.
- Migration 0073 (crew group → department routing) is still NOT applied, waiting on the user's choice.

## 2026-10-29 — Claude: Leave routing by department only (crew group = department)
- Migration `supabase/migrations/0073_leave_routes_by_department.sql` — **NOT applied yet**. Rewrites stored `Group:<crew group>` leave rules into `Dept:<uuid>` rules (one per department that has job titles in that group, same order, same approvers) and re-creates `leave_approver_ids` to match `All staff` and `Dept:` only. Test: `supabase/tests/test_leave_routes_by_department.py` (1/1).
- Website: `approvers-ui.js` no longer offers "Crew group" in "Applies to" and its tester matches by department; `hr.js` leave impact matches by department. Cache versions bumped (`g1`).
- iOS/Android do not evaluate routing themselves (database does), so no app change.

# WORKLOG — VEYORA beta

## 2026-10-29 — Claude: Leave status trail (0072), leave-submit crash fix, live page refresh, app logo, push setup
- Migration `supabase/migrations/0072_leave_status_trail.sql` — **applied on `veyora` 29 Oct** (pasted with the file hash `f7333d81…b7a2a51c` confirmed in the editor; function exists, `authenticated` can run it, `anon` cannot). `leave_trail(p_id)` returns the approval trail of one leave request (submitted, waiting for whom, or decided by whom with date and note). Tested locally (`supabase/tests/test_leave_status_trail.py`, 5 of 5). Apps: tap a request on Leaves to see it (iPhone `LeaveStatusSheet.swift`, Android `Leaves.kt`); before 0072 they showed a simpler trail built from the request.
- iPhone: submitting a leave request crashed (Swift async closure with an optional Bool); the form now hands over one `LeaveSubmission` value. Pages refresh by themselves (`LiveTick.swift`: live signal plus every 15 s); Android mirrors it with `vm.liveTick`.
- Logo is now the app icon on iPhone and Android (and the notification icon on Android). iPhone no longer shows a notification twice (push dropped while the app is open, local alert only while open).
- Website: Settings → HR & Crew → Approvers & Responsibilities redesigned (`settings.js` `hrApprovers`, `settings.css` `.ap-*`, `?v=20261029c3`): hero with live counts, rule cards with priority arrows, search-to-add people, reporting-manager card, fallback card, responsibilities grid, a "Who approves?" tester that follows the database order (manager, first matching rule, fallback), a coverage warning, and a save bar that appears on changes. Saved data shape is unchanged.
- Website: **all leave settings in one place** — HR → Leave & Absence → Settings (`#leave/settings/<types|workflow|approvers|notify|roster>`; `hr-leave-settings.js`, `approvers-ui.js`, `hr.js`, `hr.css`): leave types as cards (certificate rules inline), approval workflow, approvers & routing (with the Who-approves tester), leave notifications (owners/admins edit), weekend and "show leave on the roster". Same setting keys as before, so the apps and database are unchanged. In Settings the three moved items (Leave Types & Policies, Leave Approval Workflow, Leave Approval Notifications) now show a pointer, and Approvers & Responsibilities keeps only the other duties. The Duty Roster setting still has its own copy of the two roster fields (same keys).
- Website: **Leave & Absence page redesigned** (`hr.js` leaveHero/leaveCards/balances/leaveCalendar, `hr.css` `.lv-*`, `?v=20261029e2`): gradient hero with animated live numbers (waiting for your decision, out today, starting in 7 days, your balance), filter chips with counts and search, request cards that expand to show details and the approval trail (`leave_trail`), balance bars per leave type, and a calendar coloured by leave type (pending striped). Same data and actions as before.
- Website: Approvers & routing now uses the full page width (`settings.css` `.ap-*`, `approvers-ui.js`, `?v=20261029f3`): "Who approves?" is a wide strip with the steps side by side, manager and fallback sit together, rules and duties are two-column card grids with coloured tops; the Leave settings sections are tabs across the top instead of a side list.
- Push: secrets set on veyora via the CLI, `send_push` webhook created; the old `.p8` text was pasted in chat, so revoke that key and make a new one once push works.

## 2026-10-29 — Claude: Apple push key and send-push deployed (push not switched on yet)
- Apple Developer (team `U7YLQ2BPHJ`): registered App ID `com.trinketsisle.beta-ios` ("VEYORA beta") with Push Notifications, and a **sandbox-only** APNs key "VEYORA push" (Key ID `Y3PAVX2PS9`); a team-wide Sandbox & Production key was refused because the team already has the maximum. The `.p8` was downloaded by the user and is kept by them; I never read it. A production key (TestFlight / App Store) is still to do.
- Edge function `send-push` deployed to veyora via the dashboard editor (code hash `f2ffb0f4116f5104599c96783f51558c802eabf86ab5f224c4586289f996011d`) with Verify JWT left on. Still to do by the user: add the secrets (`APNS_KEY_ID`, `APNS_TEAM_ID`, `APNS_BUNDLE_ID`, `APNS_KEY_P8`, `PUSH_SECRET`), the database webhook on `push_outbox` insert, and the Push Notifications capability in Xcode. Until the secrets exist the function refuses every call.

## 2026-10-29 — Claude: Notifications bell, live alerts and push groundwork (0071) applied
- Migration `supabase/migrations/0071_app_notifications.sql` — **applied on `veyora` 29 Oct** (pasted with a UTF-8 clipboard; SHA-256 `11bdcd7027bca024bfd0679f4db1c174087cff054c99fe9666d3faefad95160b` matched; no warning prompt; verified: `my_notifications`, `mark_all_notifications_read`, `register_push_device`, `unregister_push_device` and the fixed `update_booking_passengers` callable by `authenticated` only, the trigger functions not callable, the five triggers exist, `notifications` is in the `supabase_realtime` publication, `push_outbox` unreadable by users and anon, 0 devices and 0 queued pushes): `my_notifications`, `mark_all_notifications_read`, new events (booking, passenger added later, cancelled booking, attendance correction and decision), push device registry and outbox, and a fix for `update_booking_passengers` (it failed on every call since 0038 with an ambiguous column). Local tests `tests/test_app_notifications.py` 23/23.
- iPhone: `NotificationsView.swift` (bell with unread count next to the avatar, list, mark read, jump to the tab, banners and badge while the app runs), `Push.swift` (asks for a token and registers it; inert until the Push Notifications capability is added). Android: `Notifications.kt` (same plus a 15-minute background check with WorkManager and system notifications). Approvals tab icon changed to a tick.
- Live alerts: `notifications` joins the `supabase_realtime` publication (in 0071). iPhone `LiveNotifications.swift` (live connection while the app is on screen, triggers an immediate refresh); Android `LiveAlertsService.kt` (foreground service with an OkHttp WebSocket to Realtime, shows the notification at once, renews the token every 45 minutes, reconnects with a growing pause; Menu → Live alerts switch; the 15-minute WorkManager check stays as a backup). Not tested against the live Realtime service yet.
- `supabase/functions/send-push` (APNs + FCM sender): written, NOT tested; needs Apple key, Firebase project and secrets (README inside). Android FCM client (google-services.json) not added.

## 2026-10-29 — Claude: Upload medical certificate (0070) applied
- Migration `supabase/migrations/0070_leave_certificate_files.sql` — **applied on `veyora` 29 Oct** (pasted with a UTF-8 clipboard; SHA-256 `f6c8da5afd95d345e47d398cbe9f1cf3851fb0c982eab42b859b229c8a373b14` matched; the destructive-operation prompt was the replaced `request_leave` signature and the delete policy definition and was confirmed; verified: bucket `leave-certificates` private with a 10 MB limit, storage policies `leave_cert_files_read / _insert / _delete`, columns `certificate_path` and `certificate_name`, `request_leave`, `attach_leave_certificate`, `my_leave_overview`, `my_approvals` and `leave_cert_can_read` callable by `authenticated` only, the rules trigger function not callable): private bucket `leave-certificates` with access rules (owner, HR, approvers), `leave_requests.certificate_path/name`, per-type `certFile` setting, `request_leave` takes the file, `attach_leave_certificate`, overview and approvals return the file. Local tests `tests/test_leave_certificate_files.py` 20/20.
- iPhone: Certificate file card in the request sheet (camera on a real phone, photo library, PDF or image file), upload to Storage, View links on requests and Approvals (camera permission text added to the project). Android: same with one picker. Website: Certificate file chooser on the request form (own requests), View certificate link in the requests table, `certFile` column in Leave Types & Policies (`hr.js?v=20261029b1`).

## 2026-10-29 — Claude: Sick leave certificate rule switched on (data change on veyora)
- At the user's explicit request, the Coral Line Ferries (Test) setting `8_leave_types_and_policies` row **Sick leave** was updated to `cert: Optional, nocert: 5, nocertRun: 2` (its other fields unchanged: 30 days, paid, note required; the other five types untouched). Done with a direct SQL update in the SQL editor, so no `setting_changed` audit entry was written.

## 2026-10-29 — Claude: Leave type cards, one per row
- Website `hr.js?v=20261029a3`, `hr.css?v=20261029a2`: Leave & Absence → Requests shows a Your leave types card list (ring, days left, Paid/Unpaid, note and certificate tags, Request button); the Request leave form picks the type from the same cards. Checked the card markup in the browser with a temporary preview page (removed); the live page could not be seen because the platform owner is not a company member, so the section is hidden for them.
- iPhone `LeavesView.swift` and Android `Leaves.kt`: balances and the type picker are one full-width card per row.

## 2026-10-29 — Claude: Medical certificate rules for leave (0069) applied
- Migration `supabase/migrations/0069_leave_certificates.sql` — **applied on `veyora` 29 Oct** (pasted with a UTF-8 clipboard; SHA-256 `d6e8171c64723dd150b3172efc73ee58dbcc4d2ed45d19f8357abe997ab684e5` matched; the destructive-operation prompt was the replaced `request_leave` signature and was confirmed; verified: column `leave_requests.certificate` and trigger `leave_cert_rules` exist, `request_leave` (6 arguments), `my_leave_overview` and `my_approvals` callable by `authenticated` only, the trigger function and `leave_used_nocert` not callable; Coral Line Ferries (Test) still has every type on Not applicable until HR sets Sick leave): per-type `cert` / `nocert` / `nocertRun`, `leave_requests.certificate`, trigger `leave_cert_rules` on every insert, `request_leave(..., p_certificate)`, overview and approvals return the new data. Local tests `tests/test_leave_certificates.py` 19/19.
- Website: Leave Types & Policies has three new columns (defaults: Sick leave Optional, 5 days, 2 in a row); the request form shows the certificate choice and rules; requests show With / No certificate (`hr.js?v=20261029a1`, `settings-defs.js?v=20261029a1`). Also fixed a syntax error in `settings-help.js` (unescaped quotes in the Shift Swap Rules help text from 0062) that stopped the whole help file from loading.
- iPhone and Android: certificate choice, remaining days without certificate, rules explained in the request sheet; Approvals cards show the flag. Not built: uploading the certificate file.

## 2026-10-29 — Claude: Leaves page in the apps (0068) applied
- Migration `supabase/migrations/0068_leave_self_service.sql` — **applied on `veyora` 29 Oct** (pasted with a UTF-8 clipboard; SHA-256 `598281e166fc1c01f365e220d5cf4d13ef577e5e96dcc1457ad09235de4f6c28` matched; Supabase's "destructive operations" prompt was only the `delete` inside `cancel_leave` and was confirmed; verified: `my_leave_overview`, `request_leave`, `cancel_leave` callable by `authenticated` only, the four helpers not callable; Coral Line Ferries (Test) has no leave types set, so it shows one default "Annual leave" with no limit) (`my_leave_overview`, `request_leave`, `cancel_leave`; helpers for weekend and working days). Local tests `tests/test_leave_self_service.py` 23/23.
- iPhone `LeavesView.swift` and Android `Leaves.kt`: hero with next leave, balance rings per type, requests (Waiting / Upcoming / Past), request sheet with live working days and balance. The Home Leaves tile opens it.

## 2026-10-29 — Claude: Approvals page in the apps (0067) applied
- Migration `supabase/migrations/0067_my_approvals.sql` — **applied on `veyora` 29 Oct** (pasted with a UTF-8 clipboard; SHA-256 `1e40229008e7957b04fd636b7ce209a5a1bc289131ea4602abd2b4e0036e4f37` matched; verified: `my_approvals` callable by `authenticated` only, `leave_can_decide` not callable; 1 pending leave request, 0 swaps, 0 corrections at the time) (`my_approvals`, `leave_can_decide`). Local tests `tests/test_my_approvals.py` 18/18.
- iPhone `ApprovalsView.swift` (Pending / History, filter chips, decision sheet, tab badge, Home tile) and Android `Approvals.kt` (same). Covers leave, shift swaps and attendance corrections; purchase requests, work orders, timesheets and payroll are still website only.

## 2026-10-28 — Claude: Phone positions on the vessel map (0066) applied
- Migration `supabase/migrations/0066_phone_positions.sql` — **applied on `veyora` 28 Oct** (pasted with a UTF-8 clipboard; SHA-256 `278660e63875f43cc9969e30dddb790c324613363a3aa2798e8a6c5e5ff1489b` matched; verified: both functions callable by `authenticated` only, `arrival_ingest` still not callable, raw `vessel_positions` unreadable by `authenticated` and `anon`, 0 fixes stored): `share_vessel_position` (checked-in staff only, feeds the arrival engine as `crew_device`) and `vessel_live_positions` (Operations only). Local tests `tests/test_phone_positions.py` 17/17.
- iPhone `PositionSharing.swift` + `OpsCheckIn.swift` (sharing badge on the checked-in card); Android `AppViewModel.kt` + `OpsCheckIn.kt`; website `operations.js?v=20261028d2` markers on the Live Vessel Map (refresh 30 s).

## 2026-10-28 — Claude: Attendance breaks (0065) applied
- Migration `supabase/migrations/0065_attendance_breaks.sql` — **applied on `veyora` 28 Oct** (pasted; SHA-256 `22d8b8288873b5a08563821bb5fbdafac94bb2ce89f58cd9b437ea706fdb0460` matched after re-copying with a UTF-8 locale, because the first paste garbled the → character; verified: table with RLS + `attb_select`, one-open-break index, close-on-clock-out trigger; `break_punch` and `my_break_state` callable by `authenticated` only; the two helpers not callable). Contents: (table `attendance_breaks`, `break_punch`, `my_break_state`, trigger closing open breaks on clock-out). Local tests `tests/test_attendance_breaks.py` 19/19.
- Website (`hr.js?v=20261028k`, `settings-defs.js?v=20261028c6`): after clocking in the register shows Break in, then Break out; Attendance Rules gets Allow breaks + Break allowance; Break column in the register. Apps: Home attendance card shows Slide to Break-In / Break-Out in place of Check-In after clocking in (iOS `HomeView.swift` + `HomeData.swift`, Android `HomeScreen.kt` + `AppViewModel.kt`).

## 2026-10-28 — Claude: Operations check-in (0064) applied
- Migration `supabase/migrations/0064_ops_checkins.sql` — **applied on `veyora` 28 Oct** (pasted; SHA-256 `91e733790e2d99684f39106bcfb9d0a1d37e178afd6df8b2b3456f9d588769b0` matched; verified: table `ops_checkins` with RLS and policy `opsci_select`; `my_ops_checkin`, `ops_checkin`, `ops_checkout`, `ops_checkin_rules`, `ops_checkins_recent` callable by `authenticated` only; `ops_open_checkin` and `ops_require_checkin` not callable by `authenticated` or `anon`).
- Apps (iOS and Android): Operations opens in Look up (read only); Check-in picks a vessel and slides to confirm, then unlocks Mark paid, Board, No-show and Cancel. Verified on the iPhone simulator: look-up, vessel sheet, check-in (row written, source `app`), persists across relaunch, check-out back to look-up. Checked-in card layout fixed (vessel and time on their own lines).
- Setting: Operations Settings → Operations Check-in (`3_operations_check_in`: enabled, enforce, hours). `enforce` is off; turn it on only after the website has a check-in button.
- Website: "Recent check-ins" card on Operations (`ops-checkins.js`, `ops-checkins.css`), Operations and HR only.
- Tests: `supabase/tests/test_ops_checkin.py` 24 checks.

## 2026-10-28 — Claude: Shift swaps default to "Same designation" (0063) applied
- Migration `supabase/migrations/0063_swap_default_designation.sql` — **applied on `veyora` 28 Oct** (pasted; SHA-256 `74b6879a88c0dcbde76665184893c9b5a6d68e6aecd68a5264ea0c3ffa6e627a` matched; verified: `swap_rules` default scope is Same designation for all 3 companies — Trinkets isle, THARIKA EXPRESS, Coral Line Ferries (Test); callable by `authenticated`). A crew member no longer sees captains in the swap picker. HR can still pick Anyone / Same crew group in Shift Swap Rules (`settings-defs.js` default now Same designation, cache-bust `?v=20261028c3`).

## 2026-10-28 — Claude: Shift swap rule "Staff can swap with" (0062) applied + redesigned Shift change
- Migration `supabase/migrations/0062_swap_designation.sql` — **applied on `veyora` 28 Oct** (pasted; SHA-256 `3275de5051141ac3ea6df85588759a956f8e98474218db78d520a3ff4f6e4c07` matched; verified: `swap_title` + `swap_same_group` exist and are not callable by `authenticated`; `swap_rules` returns `scope`; `request_shift_swap` enforces it; `swap_candidates` filters by it and returns `designation`; `my_shift_swaps` returns `requester_title` / `partner_title`).
- HR Settings → Shift Swap Rules → **Staff can swap with**: Anyone (default) / Same designation (job title) / Same crew group (`settings-defs.js`, `settings-help.js`, cache-bust `?v=20261028c2`).
- iOS Shift change redesigned (`ShiftSwapViews.swift`): summary card, Inbox / My requests / History tabs, progress steps, 21-day picker, colleague search and designation chips, send bar.
- Tests: `supabase/tests/test_shift_swaps.py` now 28 checks (scope rules included).

## 2026-10-28 — Claude: Shift swaps (0061) applied + iOS Shift change
- Migration `supabase/migrations/0061_shift_swaps.sql` — **applied on `veyora` 28 Oct** (pasted; SHA-256 `5a1d0df75884c9031ee994a6e57268b7e42579d65c66811d15c9643c7941bcbd` matched; verified: 11 functions, `shift_swaps` + 1 RLS policy, `set_roster` now calls `roster_apply`, `roster_apply` not callable by `authenticated`). Colleague swaps a day's shift: request → colleague accepts → approvers (manager / department head / Crew assignments people, HR if none) when HR rule `8_shift_swap_rules.hod` is on → roster swapped through `roster_apply` (all set_roster checks).
- HR Settings → **Shift Swap Rules** (`settings-defs.js`, `settings-data.js`, `settings-help.js`, cache-bust `?v=20261028c1` in `settings.html`): enabled, approval after the colleague accepts (default on), minimum notice hours.
- iOS test app (`beta-ios`): Home → Quick access → Shift change (request, accept/decline, approve/reject, cancel).
- Tests: `supabase/tests/test_shift_swaps.py` (0001–0061 on a local Postgres; 22 checks pass). Not yet exercised on veyora with real staff.

## 2026-10-28 — Claude: Draw boundary fixed
- Freehand: with Draw boundary on, click and drag around the berths; the stroke is simplified (Douglas–Peucker, ≤ 100 corners) and replaces the boundary. Single clicks still add corners; the map does not pan while drawing (zoom with wheel / buttons). Cache-bust `arrivals.*?v=20261028b3`.
- Harbours → Draw boundary looked dead: corners were stored but only drawn once Zone shape was already "Boundary", a pin existed and there were 3+ corners. Now Draw boundary switches the shape to Boundary, draws the outline from the first corner (line, then filled polygon), shows numbered draggable corners, adds Undo corner, keeps the corner count live, and puts the pin in the middle when there is none or it falls outside (the database requires it inside). Choosing "Boundary" in Zone shape turns drawing on.
- Files: `arrivals.js`, `arrivals.css`, cache-bust `?v=20261028b2` in `operations.html` and `settings.html`. Checked on the live site with real clicks (4 corners, undo, clear); nothing was saved.

## 2026-10-28 — Claude: Harbour Autopilot (0060) + modern Harbour setup and Arrival Lab
- Migration `supabase/migrations/0060_harbour_learning.sql` — **applied on `veyora` 28 Oct 04:53 MVT** (paste SHA-256 matched; tables, RLS, functions and cron `veyora_harbour_learn` verified; `ops_tick` still succeeding): stops from GPS → candidate spots → harbours created automatically → routes linked automatically (GPS share or exact name), all logged with undo; FollowMe also polled for learning; pg_cron `veyora_harbour_learn` every 10 min. Live check: Settings → Harbour Autopilot and Operations → Harbours both open on Autopilot. No vessel has a FollowMe link yet (0 of 6 on Coral Line Ferries (Test), 0 GPS positions), so nothing can be learned until links are added.
- Harbour setup (`arrivals.js`, `arrivals.css`): new **Autopilot** tab (first; also Settings → Operations Settings → Harbour Autopilot) with live status (pulsing when learning), KPIs and routes-ready ring, Learn now, on/off switches, satellite map of harbours (purple = learned), candidates (pulsing progress pins) and stops, learning list, activity feed with Undo; refreshes every 20 s without redrawing the map. Harbour list and Routes show **Auto** badges and a routes progress bar. Detection rules include the Autopilot settings.
- Arrival Lab (`arrival-lab.js`, `arrival-lab.css`): playback with a moving boat, live glass status card with progress ring, state timeline with scrubbing and speed, Autopilot layer.
- Tests: `supabase/tests/test_arrival_detection.py` now 61 (12 new for 0060), all pass locally. Both screens exercised against a local Postgres with 0058–0060 and synthetic stops (learn, undo, switches, routes, settings, playback, scrubbing, layer).
- Cache-bust: `arrivals.js` / `arrivals.css` `?v=20261028b1`, `arrival-lab.*` `?v=20261028b1`, settings data/defs/help `?v=20261028b1`.

## 2026-10-28 — Claude: Arrival Lab (0059 + page)
- **Applied on `veyora` 28 Oct (00:40 MVT):** 0057 (was missing), 0058, 0059 — each pasted with a matching SHA-256, run, and verified; the every-minute `ops_tick` job keeps succeeding. Settings arrival items, Arrival Lab (draft-harbour scenarios) and the Operations arrival card load without errors. No harbours exist yet: 331 open trips can't detect arrival until routes get harbours.
- Fix: a misplaced comment had dropped `.setView()` from both arrival maps (blank grey map until a scenario zoomed it).
- New platform-owner page `arrival-lab.html` (`arrival-lab.js`, `arrival-lab.css`): map with Land & sea / Satellite / Street, every harbour zone, edge band and approach ring, a drawable/draggable GPS track, 10 synthetic scenarios, replay of a real trip's stored fixes, and what-if harbour rules and detection settings. Verdicts come from the database (`arrival_simulate`), not from page code.
- Migration `supabase/migrations/0059_arrival_lab.sql` (read-only RPCs, platform owner only). Not applied on `veyora` yet; needs 0058 first.
- Settings → Operations Settings → Arrival Detection shows "Open Arrival Lab →" for the platform owner (`settings.js`, cache-bust `?v=20261028a2`).
- Fix: harbour maps from `arrivals.js` (Operations and Settings) now use Leaflet's canvas renderer. `settings.css` makes every `<svg>` 20 px, which hid the zone circles. Cache-bust `arrivals.js?v=20261028a3`, `arrival-lab.js?v=20261028a3`.
- Tests: `supabase/tests/test_arrival_detection.py` now 49 (8 new for 0059), all pass locally. The page was exercised against a local Postgres with 0058 + 0059: all scenarios, what-if, polygon and draft harbours.

## 2026-10-28 — Claude: arrival detection settings in Settings
- Settings → Operations Settings has three new items: **Arrival Detection** (the `3_arrival_detection` rules), **Harbours & Geofences** (map editor, point tester) and **Route Harbours** (origin/destination harbour per route). They are the same editors as Operations → Arrival detection → Harbours, drawn inline.
- Platform owner, owners and admins can edit them (`canEditCat`). Other people see them read-only. The database is unchanged: `is_company_ops` already includes admins and the platform owner, and Operations staff keep the Harbours button on Operations.
- `arrivals.js`: new `window.VeyoraArrivals.mountAdmin(host, company, tab, canEdit)`; the admin no longer needs `window.VeyoraOps` to load or save. Operations dialog unchanged.
- Files: `arrivals.js`, `arrivals.css`, `settings.js`, `settings-data.js`, `settings-defs.js`, `settings-help.js`, `settings.html` (now loads Leaflet + arrivals), `operations.html`. Cache-bust `?v=20261028a1`.
- Checked: scripts parse; all three tabs render, save and lock read-only against a stubbed database. Not yet clicked through signed in on `veyora`.

## 2026-10-27 — Claude: GPS harbour arrival detection (0058 + UI)
- Migration `supabase/migrations/0058_harbour_arrival_detection.sql` (not applied on `veyora` yet). Harbours with geofences; routes/trips point at origin/destination harbours; FollowMe polled every minute server-side; arrival confirmed after enough valid fixes inside the destination zone for long enough; one audited arrival per trip.
- Trips GPS can judge are no longer marked Arrived at the scheduled time; Ops get a "Confirm arrival" task if GPS never confirms. Others unchanged.
- UI (new files, apart from Cursor's): `arrivals.js`, `arrivals.css` — Operations home "Arrival detection" card (own 30 s refresh + arrival toast), Tracking tab "why arrived / pending" panel with audited correction, Harbours admin (map editor, point tester, route links, detection rules).
- `operations.js`: three hooks only (`#opsArrivals`, `#tdArrival`, `window.VeyoraOps`). `operations.html`: loads the new files, cache-bust `?v=20261027c1`.
- Tests: `supabase/tests/test_arrival_detection.py` (41 tests, real Postgres via pgserver) — all pass locally.

## 2026-10-27 — Cursor: trip-detail hull ovals
- Seat map hull no longer uses `.tdv-boat` (that class is the journey-rail 40px circle). Hull is `.tdv-hull`; seats are 16×16 rounded squares, not stretched ovals.
- Files: `operations.js`, `operations.css`, `operations.html`. Cache-bust `?v=20261027ai`.

## 2026-10-27 — Cursor: Operations Controls
- Settings → Operations Settings → Operations Controls: 12 dispatch checks, all on by default, each can be turned off.
- Wired: vessel overlap, maintenance lock, crew availability warn, capacity block, readiness checklist, disruption/affected pax, actual vs scheduled times, completion check, passenger transfer, GPS freshness, dispatch tasks, trip log.
- Files: `settings-data.js`, `settings-defs.js`, `settings-help.js`, `settings.html`, `operations.js`, `operations.css`, `operations.html`. Cache-bust `?v=20261027ah`.

## 2026-10-27 — Cursor: vessel conflict setting
- Operations Settings → Vessel Conflict Detection: toggle “Block overlapping vessel assignments” (on by default). Off lets staff assign the same boat to overlapping trips; Busy still warns.
- Files: `settings-data.js`, `settings-defs.js`, `settings-help.js`, `settings.html`, `operations.js`, `operations.html`. Cache-bust `?v=20261027ag`.

## 2026-10-27 — Cursor: vessel overlap block
- Same vessel cannot be assigned to overlapping open trips (Assign, Change vessel, Add New Trip). Busy boats show the clashing sailing. Off if Settings → Schedule Conflict Rules → Prevent double-booking a vessel is off (default on).
- Files: `operations.js`, `operations.css`, `operations.html`, `settings-help.js`, `settings.html`. Cache-bust `?v=20261027af`.

## 2026-10-27 — Cursor: live map satellite
- Live Vessel Map on Operations is a real Leaflet map. Satellite is the default (free Esri World Imagery, no API key); Map switches to OpenStreetMap.
- Files: `operations.js`, `operations.css`, `operations.html`. Cache-bust `?v=20261027ae`.

## 2026-10-27 — Cursor: speedboat hull seat map
- Trip detail Seat Map is a top-down speedboat hull (pointed bow, centre aisle, transom) instead of a rounded rectangle.
- Files: `operations.js`, `operations.css`, `operations.html`. Cache-bust `?v=20261027ad`.

## 2026-10-27 — Cursor: Schedules three-month window
- Schedules failed to load because the default fetch was 90 days back + 60 ahead (150 days). `schedule_trips` allows ~93 days. Default is now 21 back / 60 ahead, capped at 90.
- Files: `schedules.js`, `schedules.html`. Cache-bust `schedules.js ?v=20261027k`.

## 2026-10-27 — Cursor: Apple-style wind arrow
- Wind uses a circle + dart arrow like Apple Weather, next to speed, pointing to where the wind comes from (NE · from Northeast).
- Files: `operations.js`, `operations.css`, `operations.html`. Cache-bust `?v=20261027ac`.

## 2026-10-27 — Cursor: weather wind direction
- Wind on Operations overview now has a Direction tile: compass arrow, code (NE), and “from Northeast”.
- Files: `operations.js`, `operations.css`, `operations.html`. Cache-bust `?v=20261027ab`.

## 2026-10-27 — Cursor: shared WeatherAPI key
- Every company uses the WeatherAPI.com key in `config.js` (`weatherApiKey`). Operations Settings → Weather no longer stores a key (show/hide + country suffix only). Key is in place and WeatherAPI answers for Malé.
- Files: `config.js`, `operations.js`, `operations.html`, `settings-defs.js`, `settings-help.js`, `settings-data.js`, `settings.html`. Cache-bust `config.js ?v=20261027aa`.

## 2026-10-27 — Cursor: weather on Operations home
- Weather sits on the Operations overview: below the KPI cards, above the live map. Not in trip detail.
- Shows current/forecast for today's unique ports (up to 4) via WeatherAPI.com.
- Files: `operations.js`, `operations.css`, `operations.html`, `settings-defs.js`, `settings-help.js`, `settings.html`. Cache-bust `?v=20261027y`.

## 2026-10-27 — Cursor: trip weather (WeatherAPI.com)
- Trip detail Overview shows origin and destination weather under the KPI cards. Uses WeatherAPI.com current/forecast; wind follows Distance Units (knots by default).
- Key lives in Operations Settings → Weather. Restrict that key to this website in the WeatherAPI dashboard.
- Files: `operations.js`, `operations.css`, `operations.html`, `settings-data.js`, `settings-defs.js`, `settings-help.js`, `settings-engine.js`, `settings.html`. Cache-bust `?v=20261027x`.

## 2026-10-27 — Cursor: crew on board one per row
- Crew on Board in trip detail lists one person per row (overview and Crew tab).
- Files: `operations.css`, `operations.html`. Cache-bust `operations.css ?v=20261027w`.

## 2026-10-27 — Cursor: drop home Assign vessel
- Removed the separate Assign vessel toolbar button on Operations home. Unassigned sailings still get Assign on Today's Schedule.
- Files: `operations.js`, `operations.html`. Cache-bust `operations.js ?v=20261027v`.

## 2026-10-27 — Cursor: crew tab redesign
- Crew tab now matches the trip-detail cards: on-board grid with designations, open seats, Add Crew, captain, and roster fill. Vessel change stays on the trip header.
- Files: `operations.js`, `operations.css`, `operations.html`. Cache-bust `?v=20261027u`.

## 2026-10-27 — Cursor: trip detail mockup + delay/vessel
- Trip overview matches the light mockup (journey, stepper, KPIs, seat map, vessel card, crew, activity).
- Ops can change vessel and continue if the assigned boat has an issue. Delay is manual with a reason; Resume clears a delay back to Scheduled.
- Files: `operations.js`, `operations.css`, `operations.html`. Cache-bust `?v=20261027t`.

## 2026-10-27 — Cursor: held reason on Today's Schedule
- A sailing stuck past departure (no vessel, no captain, not cleared, etc.) now shows Held plus the same reason as the dispatch board, instead of looking Departed.
- Files: `operations.js`, `operations.css`, `operations.html`. Cache-bust `?v=20261027s`.

## 2026-10-27 — Cursor: date picker clickable
- Overlay date/time fields (home calendar, Add New Trip, Add passenger) now open the native picker from anywhere on the chip. Opacity-0 inputs were not clickable on Windows.
- Files: `operations.js`, `operations.css`, `operations.html`. Cache-bust `?v=20261027r`.

## 2026-10-27 — Cursor: schedule Assign vessel
- Today's Schedule shows an Assign button on sailings with no vessel. It opens the existing assign-vessel picker for that trip.
- Files: `operations.js`, `operations.css`, `operations.html`. Cache-bust `?v=20261027q`.

## 2026-10-27 — Cursor: Add Passengers wizard
- Add passenger is a fullscreen 3-step flow: pick a sailing (date + route + table), enter passengers, review and confirm. Still uses `create_booking`. Delayed stays a stored status only.
- Files: `operations.js`, `operations.css`, `operations.html`. Cache-bust `?v=20261027p`.

## 2026-10-27 — Cursor: Schedule & Route recap UI
- Add New Trip step 3 matches the sailing recap: departure / duration line / arrival, then Route, Trip type, Service.
- Files: `operations.js`, `operations.css`, `operations.html`. Cache-bust `?v=20261027o`.

## 2026-10-27 — Cursor: dropdown auto-scroll into view
- Opening a select scrolls its container so the full list is visible. If there is more room above, the list opens upward.
- Files: `select-ui.js`, `settings.css`, `operations.html`. Cache-bust `select-ui.js` / `settings.css` `?v=20261027n`.

## 2026-10-27 — Cursor: Add New Trip crew designations
- Vessel & Crew step shows each person's job title in the captain/crew dropdowns and on added crew chips.
- Files: `operations.js`, `operations.css`, `operations.html`. Cache-bust `?v=20261027m`.

## 2026-10-27 — Cursor: home Add trip / passenger / vessel
- Operations overview now shows Add passenger, Assign vessel, and Add New Trip between the calendar chips and the KPI row (Out of Service card). Same actions as dispatch.
- Files: `operations.js`, `operations.css`, `operations.html`. Cache-bust `?v=20261027l`.

## 2026-10-27 — Cursor: Add New Trip 4-step wizard
- Add New Trip is a fullscreen wizard: Trip Details, Vessel & Crew, Schedule & Route, Passengers & Notes, with a live Trip Summary.
- Still saves a one-off `trips.insert` (route, vessel, captain, kind, times, seats, note, service in meta) plus `trip_crew`. Delayed is not set automatically.
- Files: `operations.js`, `operations.css`, `operations.html`. Cache-bust `?v=20261027k`.

## 2026-10-27 — Cursor: calendar loads past dates
- Operations date chip is a calendar: pick a past (or future) day and the schedule/KPIs reload for that date. Dispatch date filter fetches outside the default window too.
- Schedules calendar loads ~90 days back; clicking a day outside the loaded window fetches that range.
- Files: `operations.js`, `operations.css`, `operations.html`, `schedules.js`, `schedules.html`. Cache-bust `?v=20261027j`.

## 2026-10-27 — Cursor: KPI icon glow
- Faint matching glow (halo + soft drop) around the round KPI wells.
- Cache-bust `operations.css?v=20261027i`.

## 2026-10-27 — Cursor: KPI icon wells
- Operations home KPIs use the mockup wells: solid round blue / green / orange / red with a white ferry, check, warning triangle, and X.
- Cache-bust `?v=20261027h`.
- Files: `operations.js`, `operations.css`, `operations.html`.

## 2026-10-27 — Cursor: vessel photos + sample boat
- Fleet Status, Fleet directory, Maintenance vessel cards, dispatch thumbs and assign-vessel list show the vessel photo when one is stored (`photo_url` / `meta.photo`). Otherwise they use `assets/boat sample.png`.
- Files: `shell.js`, `operations.js`, `operations.css`, `fleet.js`, `fleet.css`, `maintenance.js`, `maintenance.css`, matching HTML cache-bust `?v=20261027g`.

## 2026-10-27 — Cursor: Today's Schedule matches mockup
- White timeline like the mockup: navy time + route, grey vessel code, pastel status chips (green Completed / blue Departed / orange Delayed / purple Boarding / grey Scheduled), coloured rail dots only. No painted rows, count badge, or footer.
- Delayed still only when the trip is marked Delayed. Clock still infers Completed / Departed / Boarding.
- Cache-bust `?v=20261027f`.
- Files: `operations.js`, `operations.css`, `operations.html`.

## 2026-10-27 — Cursor: KPI icon centering
- Home KPI glyphs sat high-left because `.ops-hk span` overrode the icon well to `display:block`. Icon wells are now flex-centered (`<i class="ops-hk-ic">`).
- Cache-bust `?v=20261027e`.
- Files: `operations.css`, `operations.js`, `operations.html`.

## 2026-10-27 — Cursor: Today's Schedule color
- Today's Schedule was all grey because every trip was still Scheduled. Rows, dots, vessel pills, and chips now cycle sky / mint / violet / amber / indigo. Clock still paints Completed / Departed / Boarding. Delayed stays manual.
- Cache-bust `operations.css` / `operations.js` `?v=20261027d`.
- Files: `operations.js`, `operations.css`, `operations.html`.

## 2026-10-27 — Cursor: Today's Schedule completeness
- Home schedule is a full timeline: time + arrival, route, trip code, pax, vessel, status chips (Completed / Departed / Delayed +Xm / Boarding / Scheduled), Next marker, footer counts.
- Files: `operations.js`, `operations.css`.

## 2026-10-27 — Cursor: Operations live-view home
- Operations home matches the live dashboard mockup: 4 KPIs (active / on time / delays / out of service), date+clock+Live chips, **Today’s Schedule**, **Fleet Status**.
- Live Vessel Map stays **Coming soon** (legend only, no tracking).
- Full dispatch board kept at `operations.html#board` (View All / sidebar).
- Files: `operations.js`, `operations.css`, `operations.html`, `shell.js`.

## 2026-10-24 — Cursor: Operations dispatch board fidelity
- Pill tabs `Today (12)`, board title with count, auto-refresh switch chrome, status pills (Completed green / Boarding mint / Delayed red + lag), blue View, vessel thumbs, filter bar panel.
- Files: `operations.js`, `operations.css`, `operations.html`.

## 2026-10-24 — Cursor: Operations UI mockup redesign
- Dispatch board: KPI row (Today’s Trips / Delayed / Vessels / Crew), Under way cards, tab counts, trips **table** (time strip, pax bar, crew short warn, Assign vessel / View).
- Trip detail: white hero (status + route + meta), 6-step timeline with times, overview bento (seat map / boarding / crew / vessel / activity / arrival close-out).
- Files: `operations.js`, `operations.css`, `operations.html`.

## 2026-10-29 — Invite link: "User already registered" / employee stays "Invite sent"
- Cause: `accept_invite` (0050) failed on every call with `42702 column reference "settings" is ambiguous`. The login was created by sign-up, the join step failed, so the person was never added to the company; a retry then hit "User already registered".
- Fix: `supabase/migrations/0081_accept_invite_fix.sql` (variable renamed `v_settings`) — **applied 29 Oct**. `invite.js`: on "already registered" it ticks "I already have an account" and explains what to do.

## 2026-10-31 — Phones: "request timed out" and sign-outs after leaving and reopening the app
- Causes: (1) any failed token refresh, including a timeout or no signal, signed the person out; and when the app returned to the front several requests met the expired token together, each tried to refresh, and a refresh token works only once, so the losers signed out. (2) iOS closes idle connections while the app is away; the first request reused a dead one and waited its full 20 s timeout.
- iPhone: new `Net.swift` (one URLSession, replaced when the app becomes active; a GET that dies on a dead connection is retried once; friendly timeout text), `AppState.refreshSession` (one shared refresh, signs out only when the server refuses the token, new `AuthError.expired`), `refreshIfExpiring` on launch and on return, `ContentView` scene-phase hook, `API.swift`/`AuthService.swift` use them. Android `Backend.kt`: refresh behind a Mutex, sign out only on 400/401/403, `Connection: close`, GET retried once, friendly timeout text.
- Both compile; not yet seen running on a phone. Needs a new build to reach testers.

## 2026-10-31 — Staff photos in the avatar (website + both phones)
- Database `0082_staff_photos.sql` (**applied 31 Oct**): `company_members.photo_path`, private bucket `staff-photos`, `set_staff_photo(company, user, path)` (HR or the person).
- Website `hr.js`/`hr.css`/`hr.html` (`?v=20261031a1`): employee profile avatar shows the photo, HR or the person can add/change/remove it (resized to 512 px JPEG in the browser). The Employees page reads `photo_path` (works now that 0082 is applied).
- iPhone: `StaffAvatar.swift` (new), `HomeData.swift` (`photoURL`, `setPhoto`, `removePhoto`, loaded separately so a database without 0082 does not break Home), `HomeView.swift` (tap the avatar → choose/change/remove), `API.swift` (`removeFile`). Android: `Backend.kt` (`download`, `removeFile`), `AppViewModel.kt`, `HomeScreen.kt` (`PhotoAvatar`). Both compile; not yet seen running.
