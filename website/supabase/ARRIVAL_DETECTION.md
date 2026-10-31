# Automatic harbour arrival detection

Migration `0058_harbour_arrival_detection.sql` · algorithm `harbour-arrival/1.0` · tests `tests/test_arrival_detection.py`

The database decides when a trip has arrived, from GPS fixes, and records the arrival on the trip. Staff no longer have to press **Mark arrived** for trips that can be tracked. "Mark arrived" still works and is recorded as a manual arrival.

## 1. Deploying

1. Apply `0058_harbour_arrival_detection.sql` on project `veyora` in the SQL editor, after 0054. It uses the `http` extension (from 0049) and the existing every-minute `veyora_ops_tick` pg_cron job. It adds no new infrastructure.
2. Deploy `operations.html`, `operations.js`, `arrivals.js` and `arrivals.css` together. The cache-bust tag is `?v=20261027c1`.
3. Set up harbours and routes (section 2) before relying on detection. Until a route has a destination harbour, its trips behave exactly as before.
4. Make sure each vessel's FollowMe link is the **API** URL (`https://followme.mv/api/v5/public/<key>/`), not the public share page. The share page has no coordinates.

## 2. Configuring harbours (Operations → Arrival detection → Harbours)

Only owners, admins and Operations can open this screen. The same editors are in **Settings → Operations Settings** as *Arrival Detection*, *Harbours & Geofences* and *Route Harbours*, where the platform owner, owners and admins can edit them.

- **One harbour per terminal or jetty.** Two jetties on the same island are two harbours with two zones. Trips only ever check their own destination harbour, so the origin and other harbours can never trigger an arrival.
- **Pin:** choose *Place pin*, click the berth on the satellite map, or type the latitude and longitude. Coordinates are checked for range, and (0, 0) is refused.
- **Zone:** a circle (radius 20–3000 m), or *Boundary* (polygon). For a polygon, choose *Draw boundary* and click 3–100 corners; the pin must sit inside it. Keep the zone just big enough to cover the berths. Don't enlarge it to make up for poor GPS — the accuracy rule handles that.
- **Approach zone:** the distance at which a trip shows "Approaching destination" (default 2000 m).
- **Worst accuracy (m):** fixes less accurate than this never count (default 50 m).
- **Time inside (s)** and **Fixes inside:** the confirmation rule (defaults 60 s and 3 fixes; at least 2 fixes are always required).
- **Overlap:** an active zone that overlaps another active zone is refused, because it would make detection ambiguous. Tick *Allow overlap* only when two harbours really share water.
- **Test a point:** after saving, click anywhere on the map. You can enter an accuracy, or leave it blank for "unknown". You then see what the engine would decide there (inside / edge / approaching / outside) and what nearby harbours would say.
- **Routes tab:** set each route's origin and destination harbour. **Nothing is filled in automatically.** Routes that currently hold only text such as "Malé" are listed until someone chooses harbours. The suggestions only match a harbour or island name to the route text; an administrator must confirm them. When a route gets harbours, its open trips follow. Trips already under way only get one if they had none.
- **Detection rules tab:** company-wide settings, stored in the `3_arrival_detection` setting. See section 4.

## 3. How arrival is confirmed

Each fix goes through these steps in `arrival_ingest`. The step logic is the pure functions `arrival_check_obs` and `arrival_step`.

1. **Store the raw fix** in `vessel_positions`.
   - A fix with the same vessel, source, device and observed time, or the same phone queue id, is a duplicate and is never counted again.
2. **Eligibility.**
   - The vessel's trip must be *Departed / In transit*.
   - The trip must not be cancelled or already arrived.
   - The trip must have an active destination harbour.
   - Detection must be switched on.
   - A crew phone may only feed the trip its owner is captain or crew on.
3. **Validation.** A fix is rejected with a reason when any of these apply:
   - Coordinates are out of range or (0, 0).
   - The time is missing.
   - The time is more than `maxFutureSec` in the future.
   - The fix is stale: older than `maxDelaySec` when it reaches the server.
   - It is out of order: not newer than the last valid fix.
   - Accuracy is worse than the harbour's limit. **A missing accuracy is replaced by `assumedAccuracyM`** (default 30 m), never treated as precise.
   - It implies a jump faster than `maxSpeedKn`. After 2 rejected jumps in a row the track re-anchors, so one bad fix can't block a trip.
   - Rejected fixes are kept with their reason and logged.
4. **Geofence.**
   - For a circle the engine uses the distance to the pin (Haversine); for a polygon it uses ray casting plus the distance to the nearest edge.
   - The fix's uncertainty (its accuracy) is applied around the boundary:
     - **inside:** the whole uncertainty circle is inside the zone.
     - **boundary:** too close to the edge to tell. This never counts towards arrival.
     - **approach / outside:** clearly out.
5. **State machine** (`trip_arrival_state.state`):
   - Each state transition:
     - First fix *inside* → **ARRIVAL_PENDING**. The streak starts at that fix's observed time.
     - Further fixes inside add to the streak.
     - A *boundary* fix keeps the streak but doesn't count.
     - A clear *outside* fix cancels the streak → **APPROACHING_DESTINATION** / **NOT_APPROACHING**.
     - A gap longer than `maxGapSec` between fixes inside restarts the streak, because older fixes are no longer evidence.
   - **ARRIVED** when the streak has at least *Fixes inside* fixes spanning at least *Time inside* seconds. If the fix reports a speed above `passThroughKn`, confirmation waits. The boat doesn't need to be stationary.
   - **TRACKING_UNAVAILABLE** when a trip under way has had no valid fix for `trackingGapSec`. This is set by the every-minute sweep and is **never** treated as arrived.
6. **Record.**
   - One `trip_arrival_events` row; a unique index allows only one current arrival per trip.
   - The trip gets `status = 'Arrived'` and `actual_arrive` = the arrival time below.
   - A trip log line, and a notification to Operations: "Speedboat 03 arrived at Malé at 08:00 on 27 October 2026."
   - Bookings are completed only if `completeBookings` is on.
   - Finance and manifests are not touched.

**Which time is "arrived"?** The observed time of the **first valid fix inside the zone** in the streak that confirmed arrival. The event also stores:

| Field | Meaning |
|-------|---------|
| `arrived_after` | Last fix not inside. The vessel entered between this and `arrived_at`; `uncertainty_s` is the gap. |
| `confirmed_obs_at` | Observed time of the fix that completed the rule. |
| `obs_received_at` | When that fix reached the server. |
| `confirmed_at` | When the server saved the arrival. |
| `time_basis` | `device` (the GPS gave a time), `device_local` (a time without an offset, read as company local time), or `received` (the feed gave no time, so the time is when the server fetched it — honest but less precise). |

The scheduled time is never used as the actual arrival, except by the opt-in clock fallback, which is labelled `schedule_fallback`.

**Concurrency and idempotency.**
- Every fix for a trip takes a row lock on that trip's `trip_arrival_state`, so concurrent phones are evaluated one after the other.
- The unique current-event index is the last line of defence.
- Replayed fixes are duplicates, as above.
- Once a trip has arrived, later fixes are stored as `after_arrival` and change nothing.
- The automation never reopens a trip.

**Manual paths.**
- *Mark arrived* records method `manual`.
- *Correct the arrival time* (Tracking tab, Operations only, reason required) supersedes the current arrival and keeps the old one with who and why.
- Reopening a trip by hand clears its arrival.

**When GPS never confirms.** Trips GPS can judge (destination harbour set and a tracking source) are no longer marked Arrived at the scheduled time. `fallbackAfterMin` (60) minutes after the arrival time, Operations get a High dispatch task, "Confirm arrival of TR-…". With `clockFallback` on, the old clock arrival is used instead, labelled. Trips without harbours or tracking keep the old clock behaviour.

## 4. Settings (`3_arrival_detection`)

| Key | Default | Range | Meaning |
|-----|---------|-------|---------|
| enabled | true | | Detect arrivals from GPS |
| assumedAccuracyM | 30 | 5–500 | Accuracy used when a fix has none |
| maxDelaySec | 900 | 30–86400 | A fix older than this on arrival at the server is stale |
| maxFutureSec | 60 | 0–600 | Allowed clock skew |
| maxGapSec | 180 | 30–3600 | Longest gap between fixes inside before the streak restarts |
| trackingGapSec | 300 | 60–7200 | No valid fix for this long → Tracking unavailable |
| maxSpeedKn | 60 | 10–120 | Faster implied movement between fixes is a GPS jump |
| passThroughKn | 12 | 0–60 | Hold confirmation while the reported speed is higher (0 = ignore speed) |
| fallbackAfterMin | 60 | 5–1440 | When to ask Operations to confirm |
| clockFallback | false | | Use the old clock arrival when GPS never confirms |
| completeBookings | false | | GPS arrival also completes bookings (the clock arrival always did) |
| allowCrewDevices | true | | Accept crew phone fixes |
| retentionDays | 30 | 1–365 | Raw fixes and detection log kept this long |

These defaults are for initial testing. Check them against real arrivals: open a few arrived trips → Tracking → *Recent GPS fixes* and *Detection log* before relying on detection.

## 5. Monitoring

- **Trip detail → Tracking → Arrival detection** shows:
  - The state and plain-language reason ("Inside Malé T1: 2 of 3 fixes, 30 of 60 s").
  - The harbour rule.
  - The arrival record, with its window and confirmation.
  - The last 40 fixes, each marked used or not, with the reason (crew and Operations only).
  - The detection log (Operations only).
- `arrival_diagnostics` and the Postgres log (`raise log 'arrival …'`) record:
  - Rejected fixes, throttled.
  - Geofence entry and exit, and confirmation attempts.
  - Confirmations, prevented duplicates and persistence errors.
  - Tracking gaps and feed errors.

  Entries carry trip, vessel and fix ids only — no tokens, names or phone ids (device ids are hashed).
- Raw fixes aren't readable directly by app users, and are deleted after `retentionDays`.

## 5a. Autopilot: harbours learned from GPS (0060)

Nobody has to draw harbours or link routes for detection to start. Operations → Arrival detection → Harbours → **Autopilot** (or Settings → Operations Settings → Harbour Autopilot) shows it working live.

1. **GPS to learn from.** With `autoLearn` on, FollowMe is polled for every vessel under way (with or without a harbour) and in the 20 minutes before departure and after arrival, when boats sit at the berth. Still one outside call per company per minute, round robin.
2. **Stops.** Every 10 minutes the fixes become stops: the boat stayed within `stopRadiusM` (80 m) for at least `stopMinSec` (4 min), 3+ fixes. A stop is tied to the trip that arrived there (± 45 min of the arrival time) or left from there (± 30 min of departure).
3. **Candidates.** Stops at no known harbour are grouped within `mergeRadiusM` (150 m). The candidate's progress is how close it is to the rule below.
4. **Auto harbour.** A candidate with `learnMinStops` (3) stops on `learnMinDays` (2) different days, at least one tied to a trip, and a tight spread (p90 ≤ 400 m) becomes a harbour: pin at the centre of the stops, radius p90 + 30 m (60–400 m), name from the route text the trips used ("Nova Island"), island matched or created. Overnight moorings with no trip never become harbours.
5. **Auto route links.** An empty origin / destination gets the harbour where most of the route's trips really started / ended (at least 2 trips and 60 %). With no GPS yet, an exact name match (route text = harbour or island name, ignoring case and accents) is used when exactly one harbour matches. A link a person set is never changed; open trips follow the route as before.
6. **Undo.** Every change is in the activity feed. Undoing a harbour removes it (or switches it off when past trips use it), unlinks its routes and marks the spot dismissed so it is not learned again. Undoing a link keeps it unlinked (`routes.meta.auto_off_*`).

Turn learning or linking off with the switches on the Autopilot tab, or tune the numbers in Detection rules.

## 5b. Arrival Lab (platform owner)

`arrival-lab.html` (migration 0059), linked from Settings → Operations Settings → Arrival Detection when you are the platform owner. It changes nothing: no trips, positions, diagnostics or settings are written.

- **Map:** *Land & sea* (Esri topographic: sea blue, land sand), *Satellite* or *Street*. The tested harbour shows its zone (green), the GPS-uncertainty edge band for a circle (amber: a fix with the assumed accuracy counts only inside the inner ring), the approach ring (blue dashes), and every other harbour of the company (grey; they never trigger the test). Land and sea come from the map only — the algorithm itself only knows zones.
- **Track:** click the map to add fixes (interval, accuracy and speed from the side panel), drag to move, edit time / accuracy / speed / delivery delay in the table, delete rows. Each fix is coloured by the verdict: green inside and counted, amber edge (not counted), blue approaching, grey outside, red rejected, purple diamond = the fix that confirmed arrival.
- **Scenarios** (synthetic, generated around the selected harbour): clean arrival, passes by, brief entry, sits on the edge, poor GPS, no accuracy, GPS jump, signal gap, delivered late, too fast inside.
- **Replay a real trip:** loads a trip's stored fixes (with their real delivery delays) and shows what the live engine recorded next to the replay.
- **What if…:** try other harbour rules and detection settings without saving them; changed values are highlighted. A *Draft harbour* tests a pin and circle that do not exist yet.
- **Playback:** ▶ replays the track on its own clock (×10 – ×120): a boat moves between fixes, future fixes are faded, the live card on the map shows the state, reason and progress ring at that moment, and the timeline under the map shows each state as a coloured band with ticks for rejected fixes, zone entries/exits and the confirming fix. Click or drag the timeline to scrub.
- **Autopilot layer:** *Show what the Autopilot learned* adds learned harbours, candidates (with progress) and recent stops.
- Results come from `arrival_simulate`, which calls the same `arrival_check_obs` / `arrival_step` / `arrival_zone` as production. The page does not re-implement the algorithm.

## 6. Limitations of the current GPS source

- **FollowMe is the only live source, and it is polled.** FollowMe allows one call per minute per account, and 0049 enforces one outside call **per company** per minute. With one vessel under way that is one fix a minute, so confirmation with the defaults takes about 3 minutes after entering the zone. With several vessels on different FollowMe links, each vessel is refreshed less often (round-robin). Vessels sharing one link share the call.
- **FollowMe's answer format is not documented here.** The parser accepts the same fields as the Tracking map (`lat/la/latitude`, `lng/lon/lo/longitude`, `updated/time/date/timestamp`). It hasn't been checked against a live FollowMe API answer in this work.
  - If the feed gives no timestamp, arrival times are based on when the server fetched the position (`time_basis = received`), and identical repeated positions are ignored.
  - If a feed lists several boats, only an exact vessel-name match is used.
  - Accuracy is not supplied, so `assumedAccuracyM` applies. Speed is only used when the feed labels it as knots.
- **Crew phone tracking (0066).** The iPhone and Android apps send a fix about every 30 s while moving and every 2 min when still, only while the person is checked in to a vessel in Operations (`share_vessel_position`). Fixes that cannot be sent wait in a queue (up to 200, kept across restarts) and are replayed in order; each has its own id so replays are ignored. A phone position is an estimate of the vessel position (`crew_device`); an arrival confirmed only from phones is labelled `crew_device_geofence`. Limits: it works only while the app is open (no background location), a phone on the pier or in a pocket onshore is still treated as the vessel while checked in, and sparse fixes delay confirmation.
- **Tracking is evaluated server-side every minute.** If the database or the cron job is down, fixes aren't fetched for that time. Missed FollowMe positions can't be recovered later.
- **No realtime push.** The Operations page polls `ops_arrivals` every 30 s; the rest of the dashboard keeps its 60 s refresh.

## 7. Tests

```
python -m venv .venv
.venv/Scripts/pip install pgserver psycopg2-binary tzdata
.venv/Scripts/python supabase/tests/test_arrival_detection.py -v
```

`pgserver` starts a throwaway local PostgreSQL. On Windows its build ships without time-zone files: copy `tzdata/zoneinfo` into `pgserver/pginstall/share/postgresql/timezone` once. `arrival_stubs.sql` stands in for the earlier migrations, then the real 0058 is applied. The positions are synthetic points at sea.

There are 41 tests. They cover:
- A correct arrival, plus the fix-count and time-inside rules.
- Staying outside, passing near, sitting on the boundary, and a brief entry and exit.
- The origin harbour, and another island's harbour.
- Poor and missing accuracy.
- Stale, duplicate, out-of-order and missing data, and GPS jumps.
- A cancelled trip, an already-arrived trip, and a late fix after the trip has moved on.
- Several crew phones, and two concurrent confirmations (two database connections).
- Early and late arrivals, and display in Maldives time.
- No harbour configured, and lost connectivity with the queue delivered later or too late.
- Manual correction and reopening.
- The clock rules, and settings clamping.
- Geometry and FollowMe parsing.
