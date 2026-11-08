# VEYORA beta — test plan (iPhone app, Android app, database)

Last updated: 28 Oct 2026. Tick each box when it passes; write what you saw next to any failure.
Run everything twice: once on **iPhone** (`beta/beta-ios`) and once on **Android** (`beta/beta android`). Both must behave the same.

**Do not test with real staff data.** A check-in or a swap changes the live `veyora` roster and attendance.
Use the test company **Coral Line Ferries (Test)**.

## 0. What is already verified (28 Oct)

| Area | How | Result |
|---|---|---|
| Swap database logic (request, accept, decline, approve, reject, cancel, rules, roster swap) | `supabase/tests/test_shift_swaps.py` on a local Postgres | 29 of 29 pass |
| Migrations 0061, 0062, 0063 | applied on `veyora`, checked with read-only queries | applied |
| iPhone app builds; login, Home, Shift change, Operations (11 live trips) and an empty trip page open | simulator | seen |
| Android app builds; login screen | emulator | seen (nothing after login yet) |

The passenger list was seen on the iPhone simulator with the sample passengers on the 22:15 trip. Nothing below has been run by hand yet.

## 1. Accounts and data you need first

Create these in **Coral Line Ferries (Test)** (HR → Staff, Roster). Never write passwords in this file.

- [ ] **Crew A** and **Crew B**: same designation (for example Deckhand), both with a roster shift on the same future day, **different** shifts (for example A = D, B = E).
- [ ] **Crew C**: same designation as A, working the **same shift** as A that day.
- [ ] **Captain**: a different designation, with a shift that day.
- [ ] **HOD / manager**: set as A's manager (HR → Organization), or named under Crew assignments (Settings → Approvers & Responsibilities).
- [ ] **HR user**: role HR, owner or admin.
- [ ] **No-designation staff** (optional): someone with no job title.
- [ ] Roster for today for A: a shift that already started (to test late minutes), and a day with no roster entry.
- [ ] Shift Definitions with colours (Settings → Shift Definitions) so badge colours can be checked.
- [ ] Settings → Mobile Check-in & Check-out (IT): note the current values (network, device, departments). They can block check-in.

## 2. Login (iPhone and Android)

- [ ] Email and password → signs in, Home opens.
- [ ] Staff ID and password (for example `VY-XXXXXX-0042`) → signs in.
- [ ] Wrong password → red message, stays on login.
- [ ] Empty fields → "Enter your email or staff ID." / "Enter your password."
- [ ] Airplane mode → "Can't reach the server…" (no crash, no endless spinner).
- [ ] Show/hide password eye works. Keyboard "Next" then "Go" works.
- [ ] Close and reopen the app → still signed in.
- [ ] Menu → Sign out → login screen; reopening does not sign back in.
- [ ] Leave the app 1+ hour, reopen → still works (token refresh) or asks to sign in again, never a blank screen.

## 3. Home

**Header and shift card**
- [ ] Greeting matches company time (morning / afternoon / evening / night), first name, today's date.
- [ ] Shift card shows today's times, a live clock ticking every second, a progress bar and "Xh Ym left".
- [ ] Before the shift: "Starts in …". After it: "Shift ended".
- [ ] Status chip: "Not checked in" → "On shift" (green pulsing dot) → "Shift complete".
- [ ] A day off shows "No shift today / Enjoy your day off".
- [ ] Staff number shows when the account has one.
- [ ] Account with no company → message instead of the week, no crash.
- [ ] Pull down to refresh updates the data.

**Attendance (slide to check in / out)** — writes real attendance; use the test company
- [ ] Location permission prompt appears once; allow → no second prompt.
- [ ] Slide Check-In all the way → steps show ("Getting your location…", "Checking network and device…", "Saving…", "Updating…") and the time appears in the green chip.
- [ ] Location is quick (under about 2 seconds with GPS already warm).
- [ ] A short drag springs back and does nothing.
- [ ] Check-Out slider is greyed until you have checked in, then works; after it, both sliders are greyed.
- [ ] Sliding Check-In twice (second device) → "Already clocked in today at …".
- [ ] Deny location → check-in still works unless HR Attendance Rules require location (then it says so).
- [ ] IT rule "Approved networks only" or "Registered devices only" on → the red message explains why it was refused, and nothing is saved.
- [ ] IT rule "Allow clocking in from the app" off → refused with the reason.
- [ ] Airplane mode while sliding → red error, spinner stops, can retry.
- [ ] Late check-in (after shift start + grace) → "Late by N min" under the Check-In time; the week row shows "Late · N min".
- [ ] Check-in within the grace period → status Present, no late label.
- [ ] The web HR page (Attendance) shows the same times and status as the app.

**Your week (list)**
- [ ] Eight cards, Sunday to next Sunday; today highlighted with a "TODAY" tag and a progress line.
- [ ] Coloured bar and code badge match Shift Definitions colours.
- [ ] Status pills: Present, Late · time, Absent, Off Duty, On Duty, No record, On leave show the right colours and icons.
- [ ] Summary chips: shifts, scheduled hours, present count are correct against the roster.
- [ ] Tap a day → details sheet with punches; "No punches recorded" for empty days.
- [ ] Times are in the company timezone (Maldives), not the phone's timezone (change the phone timezone and check).
- [ ] Day with attendance but no roster entry (known quirk) shows "Day off" with an Absent pill.

## 4. Shift calendar

- [ ] Home → Calendar opens the month list; month arrows change months.
- [ ] A month with no roster shows off days without errors.
- [ ] Tap a day → sheet with CI/CO timeline, times with seconds, place name (or coordinates), "Late by …" on CI when late.
- [ ] Back button / Android back returns to Home.

## 5. Shift change (swap requests)

Use two phones or sign out and in between accounts. Rule setting is at HR Settings → Shift Swap Rules (website).

**Request screen (as Crew A)**
- [ ] Quick access → Shift change opens with counts and tabs (Inbox, My requests, History).
- [ ] New swap request → day strip shows only working days as selectable; off days greyed.
- [ ] Banner explains the rule ("colleague accepts, then an approver confirms" or "swaps as soon as…").
- [ ] Default rule (Same designation): only same-designation colleagues are listed; the Captain is **not** listed.
- [ ] Crew C (same shift as A) is listed but greyed "Same shift as you" and cannot be picked.
- [ ] Search by name works; designation chips appear when more than one designation is listed.
- [ ] Pick Crew B → preview "You → E ⇄ Bob → D"; the send button names Bob.
- [ ] Optional note is sent and shown on the card.
- [ ] Send → "Sent", sheet closes, request appears under **My requests** with progress steps.
- [ ] Sending a second request for the same day → "You already have an open swap request…".

**Colleague answers (as Crew B)**
- [ ] B gets a notification (web bell) and sees the request in **Inbox** with Accept / Decline.
- [ ] Decline → A sees "Declined"; roster unchanged.
- [ ] Accept with approval **on** → status "Waiting for approval"; roster **not** changed yet.
- [ ] Accept with approval **off** → roster swaps immediately; both get a "done" notification; Home week shows the new shifts for A and B.

**Approver (as HOD, then as HR)**
- [ ] HOD sees it in Inbox with Approve / Reject; Crew A, Crew B and a stranger cannot approve.
- [ ] Approve → roster swapped, both notified.
- [ ] Reject → roster unchanged, both notified, note shown.
- [ ] With nobody named as manager, department head or Crew assignments approver → HR can approve.
- [ ] A user cannot approve their own swap.

**Rules and safety**
- [ ] Rule "Anyone" → Captain appears in the list; rule "Same crew group" → only the same crew group.
- [ ] Rule "Allow shift swap requests" off → "Shift swaps are switched off".
- [ ] Minimum notice set to e.g. 24 hours → a request for tomorrow is refused with the notice message.
- [ ] A swap that breaks rest hours, weekly hours or consecutive days → approval/accept shows the rule message and the request stays open.
- [ ] Person on approved leave that day → refused.
- [ ] Locked or published-locked roster period → refused.
- [ ] Roster changed by HR after the request was sent → "The roster … changed after this request, so it cannot be swapped."
- [ ] Cancel request (requester) works while open; not possible after it is closed.
- [ ] History tab shows approved, declined, rejected and cancelled; "Approved" count on the summary card is right.
- [ ] Pull to refresh; a request answered on another phone updates after refresh.

## 6. Website (HR) checks

- [ ] HR Settings → Shift Swap Rules shows: allow requests, approval after the colleague accepts, **Staff can swap with** (default Same designation), minimum notice.
- [ ] Saving each option changes the app list immediately after pull-to-refresh.
- [ ] After a swap, the Duty Roster page shows the new shifts and "roster changed" in the audit log.
- [ ] HR → Attendance shows app punches with correct time, status and source.
- [ ] IT → Clock-in activity lists refused attempts with the reason.

## 7a. Operations tab (trips of the day and passenger list)

Bottom bar: Home, **Operations**, Approvals, Leaves, Menu. Home → Quick access → Operations opens the same page.
Needs a company with trips today. Sample passengers for the 22:15 trip (TR-2026-000340) are already loaded in Coral Line Ferries (Test): 6 bookings, 10 passengers (3 Checked in, 2 Boarded, 1 No-show, 4 Booked). The script is `supabase/test-data-ops-trip-passengers.sql`; its last lines remove the sample data again. For other days or trips, add bookings on the website (Operations → trip → Add booking).

- [ ] Operations tab opens on **Today** with every trip of the day in time order (compare with the website Operations → Daily).
- [ ] Summary tiles (Trips, Active, Delayed, Cancelled) match the website board.
- [ ] Each card shows departure time, arrival, route (origin → destination), vessel, captain, trip code, status pill and seats booked / total with a bar.
- [ ] The next trip that has not left yet is highlighted with a "NEXT" tag; finished trips are dimmed.
- [ ] Delayed or cancelled trips show their reason in the status colour.
- [ ] Filters work: All, Upcoming, Active, Done.
- [ ] Arrows move to the previous and next day; tapping the date returns to today; a day with no trips says "No schedules for this day".
- [ ] Times are in company time (Maldives), not the phone's timezone.
- [ ] The list refreshes by itself about every 30 seconds and on pull to refresh (change a trip status on the website and watch it update).
- [ ] Tap a trip → trip page with route, departs, arrives, vessel, captain, status.
- [ ] Counts (Seats sold, Checked in, Boarded, No-show) match the website manifest. On the sample trip: Seats sold 10, Checked in 3, Boarded 2, No-show 1.
- [ ] Passenger list: name, category, booking reference, seat (only when Seating is on), status pill; sorted by booking.
- [ ] Filter chips (All, Booked, Checked in, Boarded, No-show, Cancelled) show the right counts; search finds by name and by booking reference.
- [ ] Tap a passenger → details (seat, category, booking, phone, nationality, ID number, fare, payment).
- [ ] A trip with no bookings shows "No passengers booked yet".
- [ ] Check a passenger on the website (check in / board) and confirm the app updates within 30 seconds.
- [ ] A user who is not a member of the company cannot load the page (message, no crash).
- [ ] Menu → **Location test** still shows live latitude and longitude (the old Operations map screen moved here).

## 7b. Passenger page and actions (Operations → trip → passenger)

Sample data: trip TR-2026-000340 (22:15 today) in Coral Line Ferries (Test), 6 bookings / 10 passengers with fares (totals 300, 60, 500, 80, 200, 120 MVR), all **Unpaid**. Scripts: `supabase/test-data-ops-trip-passengers.sql` and `supabase/test-data-ops-trip-fares.sql`.
These actions **change live booking data** in the test company: do them only there, and reset with the removal lines at the bottom of the first script.

**Seating (Settings → Operations Settings → Seating)**
- [ ] Default (off): no seat numbers anywhere in the apps: not on passenger rows, not in the passenger hero, not in "Travelling together". The trip tile still counts "Seats sold".
- [ ] Turn "Use seat numbers" on (website, Settings → Operations Settings → Seating), pull to refresh or reopen the app: seat pills show on rows, "Seat A1" shows in the passenger hero and in "Travelling together".
- [ ] Turn it off again: seat numbers disappear again.

**Look**
- [ ] Hero: avatar with a status-colour ring (iPhone), name, category and nationality tags, status pill, seat (only when Seating is on), route and departure time.
- [ ] Progress steps: Booked → Checked in → Boarded, with check-in and boarding times; No-show and Cancelled show in red and grey.
- [ ] Payment card: Booking total, Paid, Due in the company currency, payment status pill, "Paid by …".
- [ ] Booking card: reference, source, booked by, ticket, note, and a "Travelling together" list with each person's status.
- [ ] Passenger card: ID number, nationality, fare; the Call button opens the dialler with the number.
- [ ] Row on the trip page shows a payment icon (green tick when Paid, card when unpaid).

**Check-in, boarding, no-show**
- [ ] Booked passenger: **Check in** works inside the check-in window; outside it (more than 60 minutes before departure, or the number set in Passenger Settings → Check-in Rules) the red message "Check-in opens N minutes before departure." appears and nothing changes.
- [ ] **Board now** and **Board passenger** work; time appears under Boarded; the trip counts update.
- [ ] **No-show** asks for confirmation; **Undo no-show** and **Undo check-in** / **Undo boarding** restore the previous status.
- [ ] The change shows on the website manifest within a minute and on the trip page list straight away.
- [ ] Haptic feedback on success and on error (iPhone).

**Payment**
- [ ] Payment methods list matches Finance Settings → Payment Methods; the default is the first one.
- [ ] **Mark … paid** sets Paid, Paid = booking total, Due 0.00, and "Paid by <method>"; the button disappears; the payment icon turns into a green tick.
- [ ] For a multi-passenger booking the whole booking total is marked paid (all three family members show Paid).
- [ ] The paid booking appears on the website (Operations booking, Finance ledger).
- [ ] A booking with total 0 shows Paid and no Mark-paid button.
- [ ] Marking an already-paid booking is not offered; a refused change shows the database message.

**Cancel**
- [ ] **Cancel this passenger** asks to confirm, then the passenger is Cancelled, the seat is freed and the booking total drops.
- [ ] **Cancel whole booking** (shown only when more than one passenger) cancels every passenger and shows refund due when something was paid.
- [ ] A cancelled passenger shows no action buttons.

**Both apps**
- [ ] Same results on iPhone and Android for every step above; the Android sheet scrolls fully and the confirm dialogs work.

## 7c. Operations check-in (staff activity) and look-up mode

Staff have **two check-ins**: the **shift** check-in on Home (attendance) and the **Operations** check-in on the Operations tab. Operations check-in records who worked Operations, on which vessel, and when. Without it the app is in **look-up mode** (read only). Needs migration 0064 on `veyora`.
Setting: website → Settings → Operations Settings → **Operations Check-in** (use check-in / enforce in the database / hours). Recent check-ins are on the **website Operations page only**; the apps never list them.

**Look-up mode (not checked in)**
- [ ] Operations tab shows a Look up / Check-in switch with Look up selected and the line "Look up is read only…".
- [ ] You can browse trips, the trip page, passenger rows and the passenger page.
- [ ] Passenger rows have no quick Check in / Board button; the passenger page shows the orange "Look-up mode" banner with a Check in button and **no** Check in, Board, No-show, Undo, Mark paid or Cancel buttons.
- [ ] Tapping Check-in (switch) or the banner's Check in opens the check-in sheet.

**Check in**
- [ ] The sheet lists your vessels; the vessel of the next trip is preselected with a "Next trip" tag; "No vessel (shore / office)" is also offered.
- [ ] Slide to check in is disabled until something is chosen; location permission is asked once.
- [ ] After sliding: the switch moves to Check-in (green), a green card shows "Checked in to Operations · <vessel> · since HH:MM · N min".
- [ ] Rows now show Check in / Board buttons; the passenger page shows all actions (Check in, Board, No-show, Mark paid, Cancel).
- [ ] Checking in twice (second phone) is refused: "You are already checked in to Operations … Check out first."
- [ ] Close and reopen the app: still checked in (the session lives on the server).

**Check out**
- [ ] Check out (card button, or tapping Look up) asks to confirm; afterwards the app is in look-up mode again.
- [ ] A check-in that was never closed stops counting after the rule's hours (default 16): the app goes back to look-up mode.

**Website**
- [ ] Operations page shows a **Recent check-ins** card: name, designation, vessel, check-in time and date, "Checked in" (green) or "Out HH:MM · duration".
- [ ] The card refreshes within 30 seconds; staff without Operations or HR access do not see it.
- [ ] No "Recent check-ins" list anywhere in the iPhone or Android app.

**Enforcement (optional)**
- [ ] With "Also enforce it in the database" on, an action sent without a check-in is refused with "Check in to Operations first…" (the website needs a check-in too, so test in the test company only).
- [ ] With the check-in setting off, the apps behave as before (no switch, everything unlocked).

## 7. Menu and location test

- [ ] Menu → Location test shows live latitude, longitude, accuracy and speed; the switch pauses and resumes it.
- [ ] iPhone: satellite map with a blue dot and a re-centre button.
- [ ] Android: readout only (no map yet, known).
- [ ] Location off in phone settings → the screen says so.
- [ ] Approvals and Leaves tabs show "Coming soon".

## 8. Design and device checks (both apps)

- [ ] Small phone and large phone: no text cut off, week rows do not wrap, pills stay on one line.
- [ ] Larger system font size: layout still usable.
- [ ] Rotate / split screen: nothing crashes.
- [ ] Dark mode only (app is always dark); status bar text is readable.
- [ ] Animations: cards slide in, slider feels smooth, no flicker on refresh.
- [ ] Slow network: spinners show and clear; no endless loading.
- [ ] Back gesture / back button on every sub-screen.

## 9. Database tests (run any time)

```bash
python -m venv .venv && .venv/bin/pip install pgserver psycopg2-binary
.venv/bin/python beta/supabase/tests/test_shift_swaps.py     # expect RESULT 29 / 29
.venv/bin/python beta/supabase/tests/test_arrival_detection.py -v   # arrival detection (61)
```

The swap test applies migrations 0001–0063 on a throwaway Postgres. It prints one known failure for 0040 (a stand-in for the digest function); the swap checks still run.

## 10. Known issues and risks to watch

- **UTC date in the database:** `clock_punch` uses the database's date (UTC). Between about 00:00 and 05:00 Maldives time, "today" in the app and in the database can differ. Test a punch just after midnight.
- **Attendance with no roster entry** shows "Day off" plus "Absent" (the app shows both records as stored).
- **Check-in can be refused** by IT rules (network, device, department); this is expected, not a bug.
- **Session storage on Android** is plain app-private storage (test app only).
- **Android Operations** has no map (needs a Google Maps key).
- **Swaps are same-day only.** Different-day swaps are not supported yet.
- **Colleagues on an OFF day appear in the swap list** (taking their day off is allowed).
- **Emulator:** stale lock files in `~/.android/avd/Pixel_10_Pro.avd/` can stop it starting when no emulator is running.

## 11. Result log

| Date | Tester | Device | Section | Result | Notes |
|---|---|---|---|---|---|
| | | | | | |


## 7d. Breaks (website, needs migration 0065)

1. HR Settings → Attendance Rules: switch on **Allow breaks** and set an allowance (try 30 minutes).
2. Website → HR & Crew → Duty & Attendance → Attendance register. Before clocking in only **Clock in** shows.
3. Clock in. The row now shows **Break in** and **Clock out** (Clock in is gone).
4. Break in. The row shows **Break out** and "on break since HH:MM"; Clock out is hidden. The register's **Break** column shows "on break".
5. Break out. Break in / Clock out come back; the Break column shows the minutes used.
6. Take breaks until the allowance is used: another Break in is refused with the allowance message.
7. Break in, then Clock out from HR's **Correct**: the break ends at the clock-out time.
8. Switch Allow breaks off: no Break buttons; the Break column disappears.

**Apps (iPhone and Android):** on Home, once you have checked in and HR has allowed breaks, the **Check-In** slider is replaced by **Slide to Break-In** (with "Used N of M min"). After you break in it becomes **Slide to Break-Out** and the Check-Out slider is disabled until you break out. Break-Out brings Break-In back. With breaks switched off the Check-In row stays as before.


## 7e. Phone positions on the vessel map (needs migration 0066)

1. iPhone or Android: Operations tab, **Check in to a vessel** (pick a real vessel, not "No vessel"). The green card shows **Sharing location · sent HH:MM** after the first fix (up to 2 minutes).
2. Website → Operations (as Operations staff): the **Live Vessel Map** shows the vessel as a dot with its name. Click it: state, trip, speed, "Crew phone (estimate)", age and accuracy.
3. Colours follow the legend: green Underway, blue At port, amber Delayed, red Restricted. A position older than 30 minutes is faded and says "stale".
4. Turn on flight mode for a few minutes, then off: the card says "Waiting for signal (N queued)", then catches up.
5. Check out: the card disappears and no more fixes are sent. Checked in with **No vessel**: nothing is shared.
6. With a trip under way (status Departed) for that vessel, open the trip's arrival details: the phone fixes show as crew-device fixes.


## 7f. Approvals (needs migration 0067)

1. Sign in as someone who approves leave (owner, HR or a named approver). Create a pending leave request for a colleague (website HR → Leave), a shift swap that needs approval (app: Quick access → Shift change, with HR's "Swaps need approval" on), and an attendance correction (website, as non-HR).
2. **Approvals tab** (and Home → Quick access → Approvals): the tab shows a number badge. **Pending** lists each request with name, designation, kind, dates or shifts, the reason, and how long ago it was asked.
3. Filter chips: All / Leave / Shift swaps / Attendance, each with a count.
4. **Reject** opens a sheet with an optional comment; **Approve** opens the same. If HR's Leave Approval Workflow requires a comment, leave decisions cannot be confirmed without one.
5. After deciding, the card leaves Pending and appears under **History** (30 days) with Approved or Rejected and your note. The requester sees the result in their own app or on the website.
6. As someone who is not an approver: Pending is empty ("You're all caught up"). You never see your own leave or swap to approve.
7. Leave routed to named approvers (Settings → Approvers & Responsibilities): only they and the owner see it; HR who is not named does not.
8. Without migration 0067 the page says "Approvals are not set up yet" instead of failing.


## 7g. Leaves (needs migration 0068)

1. **Leaves tab** (and Home → Quick access → Leaves). The top card shows your **next approved leave** with days to go, or "Plan your next break". It also shows days taken and waiting, and a **Request leave** button.
2. **Balances:** one card per leave type from HR Settings → Leave Types & Policies. A ring shows days used (solid = approved, light = waiting) with the days left in the middle; types without a yearly limit show ∞. Paid or Unpaid is tagged. Tap a card to request that type.
3. **Request leave:** pick a type, From and To dates. The page shows the working days (weekend days from Duty Roster are skipped) and how many days are left after. The button stays off when the dates are only weekend days, you are over the limit, or a required note is empty.
4. Submit. If HR's approval is on it appears under **Waiting**; if approval is off it is approved straight away. Approvers see it on their **Approvals** tab and on the website.
5. Refusals show the database's message: more than the yearly limit, overlapping with your own leave, a note is required, only weekend days.
6. **Waiting → Cancel request** takes back a request nobody has decided. Approved or rejected requests have no cancel.
7. **Upcoming** lists approved leave from today on; **Past** lists finished and rejected leave, with the approver's comment when there is one.
8. Without migration 0068 the page says "Leave is not set up yet".


## 7h. Sick leave with and without a medical certificate (needs migration 0069)

1. Website → Settings → HR & Crew → **Leave Types & Policies**. For **Sick leave** set Medical certificate = **Optional**, Days per year = 30, **Days without certificate** = 5, **Max days in a row without certificate** = 2. Save. (A new company gets these defaults. **Required** means every request needs a certificate.)
2. Website → Leave & Absence → Request leave → Sick leave: a **Medical certificate** choice appears (With / Without) with the note "x of 5 days left without a certificate this year, at most 2 in a row". Switching the type to Annual leave hides it.
3. Without a certificate: 2 working days is accepted; 3 in a row is refused ("at most 2 working days in a row"); with a certificate the same 3 days are accepted.
4. Take uncertified sick days until 5 are used: the next one is refused ("Without a certificate Sick leave allows 5 working days a year"); a certified day is still accepted until the 30-day total.
5. Two uncertified requests on days that run into each other (also across the weekend) count as one stretch for the "in a row" limit.
6. Apps: Leaves tab → Sick leave card shows "x without certificate"; the request sheet has **With certificate / Without**, shows the remaining days and the stretch limit, and keeps Submit off with a message when the choice would break a rule. A **Required** type shows "A medical certificate is required".
7. Requests show "With / No medical certificate"; the approver sees the same on the Approvals card and in the website review list.
8. The rules also apply to the website form and any direct save: they are enforced in the database.


## 7i. Leave type cards (website and apps)

1. **Website → HR & Crew → Leave & Absence → Requests** (as a staff member, not the platform owner): above the requests list a **Your leave types** section has one card per row for every leave type. Each card shows a ring with the days left, "x of y working days used this year", and tags: Paid or Unpaid, Note required, and the certificate rule (for example "Certificate optional · 2 of 5 days without · 2 in a row" or "Certificate required"). A type with no days left shows "No days left" instead of the Request button.
2. **Request** on a card opens the request form with that type already chosen. The form lists all leave types as cards, one per row, with the chosen one highlighted and ticked; clicking another card switches the type, the certificate choice and the live balance line.
3. **Apps (Leaves tab):** the balances are one card per row (ring, days used, tags, a Request button). In the request sheet the types are the same cards with a selected state.


## 7j. Uploading the medical certificate (needs migration 0070)

1. Website → Settings → HR & Crew → Leave Types & Policies → **Sick leave**: set **Certificate file required** on (new column) and save.
2. **iPhone / Android** → Leaves → request Sick leave → choose **With certificate**. A **Certificate file** card appears marked Required. On iPhone it offers Take photo (on a real phone), Photo and File; on Android, one button for a photo or PDF. After choosing, it uploads and shows the file name with a green tick and an x to remove it. Submit stays off until a file is attached.
3. Choosing **Without** hides the file card. A type with the file switched off shows it as Optional.
4. Files over 10 MB, or anything that is not a PDF or photo, are refused with a message.
5. The request in your list shows the file name; tap it to open the certificate (opens in the browser or viewer through a link that expires in 5 minutes).
6. **Approver** (Approvals tab, or website Leave & Absence): the leave card shows the file; tap to open it. HR can open any certificate. Another staff member who is not an approver gets "You can't open that file".
7. **Website**: Request leave → Sick leave → With a certificate shows a **Certificate file** chooser (for your own requests); the requests table shows "View certificate" under the type.
8. Not built: HR cannot upload a certificate on someone else's behalf; a rejected request's file stays in storage.


## 7k. Notifications: the bell (needs migration 0071)

1. **Apps:** a **bell** sits next to the avatar on Home and Leaves, and in the top corner of Approvals and Operations. A red number shows how many are unread. (The Approvals tab icon is now a tick so there are not two bells.)
2. Tap the bell: **Notifications** lists them newest first, grouped Today / Yesterday / dates, with an icon for the kind, a blue dot while unread, and the time. Pull to refresh. **Mark all read** clears the badge.
3. Tap one: it is marked read and the app jumps to the tab it is about (bookings and trips go to Operations; leave requests, swap approvals and attendance corrections go to Approvals; leave decisions go to Leaves).
4. Make these happen from the **website** (as someone other than the person you test with) and watch the bell within 45 seconds:
   - a **new booking** on a trip, as Operations or the trip's captain gets it (not the person who made it);
   - a **passenger added** to an older booking, and a **cancelled booking** (with the reason);
   - a **leave request**, a **shift swap waiting for approval** or an **attendance correction** reaches the approver or HR; the person who asked gets the decision.
5. While the app is open a new item also shows as a banner (allow notifications the first time), and the app icon badge shows the unread count.
6. **Live alerts (instant):** the apps keep a live connection to Supabase Realtime, so a new notification shows within a second or two instead of at the 45-second check. **iPhone:** while the app is on screen. **Android:** a small "Live alerts on" notification stays while you are signed in and the service keeps the connection even with the app closed; **Menu → Live alerts** switches it on or off. Test: with the app closed on Android, make a booking from the website as someone else; the phone shows the notification at once. If it does not, exempt the app from battery optimisation (some phone makers stop background services). A 15-minute background check stays as a safety net (allow notifications when asked).
7. **Push** (a message arrives with the app closed, on iPhone): needs your Apple key, the Push Notifications capability and the `send-push` function; see `supabase/functions/send-push/README.md`. Until then iPhone alerts show only while the app is running.
8. Without migration 0071 the list says "Notifications are not set up yet".
