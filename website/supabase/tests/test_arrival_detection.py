"""Automated tests for 0058_harbour_arrival_detection.sql, 0059_arrival_lab.sql and 0060_harbour_learning.sql on a real local PostgreSQL.

Run (needs Python 3.9+; installs nothing into the project):
    python -m venv .venv && .venv/Scripts/pip install pgserver psycopg2-binary      (Windows; bin/pip elsewhere)
    .venv/Scripts/python supabase/tests/test_arrival_detection.py -v

The database is a throwaway Postgres started by pgserver. arrival_stubs.sql stands in for the earlier migrations;
then the real 0058, 0059 and 0060 migrations are applied. All positions are synthetic points at sea, not real harbours or customers.
"""
import math
import os
import tempfile
import threading
import time
import unittest
import uuid
from datetime import datetime, timedelta, timezone

import pgserver
import psycopg2
import psycopg2.extras

HERE = os.path.dirname(os.path.abspath(__file__))
MIGRATION = os.path.join(HERE, "..", "migrations", "0058_harbour_arrival_detection.sql")
LAB = os.path.join(HERE, "..", "migrations", "0059_arrival_lab.sql")
LEARN = os.path.join(HERE, "..", "migrations", "0060_harbour_learning.sql")
STUBS = os.path.join(HERE, "arrival_stubs.sql")

# Synthetic geography (open sea, fictional harbours).
DEST = (4.1000, 73.5000)    # destination harbour pin, radius 150 m
ORIGIN = (4.3000, 73.4000)  # origin harbour pin
OTHER = (4.1100, 73.5000)   # another island's harbour, ~1.1 km north of DEST
T0 = datetime(2026, 10, 27, 2, 50, tzinfo=timezone.utc)   # 07:50 Maldives time
SCHED_ARRIVE = datetime(2026, 10, 27, 3, 0, tzinfo=timezone.utc)  # 08:00 Maldives time

psycopg2.extras.register_uuid()


def offset(point, north_m=0.0, east_m=0.0):
    lat, lng = point
    return (lat + north_m / 111195.0, lng + east_m / (111195.0 * math.cos(math.radians(lat))))


class DB:
    server = None
    dsn = None


def setUpModule():
    DB.dir = tempfile.mkdtemp(prefix="veyora_arrival_")
    DB.server = pgserver.get_server(DB.dir, cleanup_mode="stop")
    base = DB.server.get_uri()
    con = psycopg2.connect(base)
    con.autocommit = True
    con.cursor().execute("drop database if exists arrival_test")
    con.cursor().execute("create database arrival_test")
    con.close()
    DB.dsn = base.rsplit("/", 1)[0] + "/arrival_test"
    con = connect()
    with open(STUBS, encoding="utf-8") as f:
        con.cursor().execute(f.read())
    with open(MIGRATION, encoding="utf-8") as f:
        con.cursor().execute(f.read())
    with open(LAB, encoding="utf-8") as f:
        con.cursor().execute(f.read())
    with open(LEARN, encoding="utf-8") as f:
        con.cursor().execute(f.read())
    con.close()


def tearDownModule():
    try:
        DB.server.cleanup()
    except Exception:
        pass


def connect(uid=None, platform=False):
    con = psycopg2.connect(DB.dsn)
    con.autocommit = True
    if uid:
        con.cursor().execute("select set_config('test.uid', %s, false)", (str(uid),))
    if platform:
        con.cursor().execute("select set_config('test.platform', 'on', false)")
    return con


def q(con, sql, *args):
    cur = con.cursor(cursor_factory=psycopg2.extras.RealDictCursor)
    cur.execute(sql, args)
    return cur.fetchall() if cur.description else None


def q1(con, sql, *args):
    rows = q(con, sql, *args)
    return rows[0] if rows else None


def val(con, sql, *args):
    cur = con.cursor()
    cur.execute(sql, args)
    row = cur.fetchone()
    return row[0] if row else None


class World:
    """A company with ops/captain/crew/outsider users, three harbours, a route and a departed trip."""

    def __init__(self, con, settings=None, harbours=True, status="Departed", dest_kw=None):
        self.con = con
        self.company = val(con, "insert into companies (name, settings) values ('Test Ferries', %s) returning id",
                           psycopg2.extras.Json(settings or {}))
        self.ops, self.captain, self.crew, self.crew2, self.outsider = (uuid.uuid4() for _ in range(5))
        for u, role in ((self.ops, "operations"), (self.captain, "crew"), (self.crew, "crew"), (self.crew2, "crew"), (self.outsider, "crew")):
            q(con, "insert into auth.users (id) values (%s)", u)
            q(con, "insert into company_members (company_id, user_id, role) values (%s, %s, %s)", self.company, u, role)
        self.island = val(con, "insert into islands (company_id, name) values (%s, 'Test Island D') returning id", self.company)
        kw = dict(radius_m=150, max_accuracy_m=50, dwell_sec=60, min_obs=3)
        kw.update(dest_kw or {})
        self.dest = val(con, """insert into harbours (company_id, island_id, name, lat, lng, radius_m, max_accuracy_m, dwell_sec, min_obs)
                                values (%s, %s, 'Test Harbour D', %s, %s, %s, %s, %s, %s) returning id""",
                        self.company, self.island, DEST[0], DEST[1], kw["radius_m"], kw["max_accuracy_m"], kw["dwell_sec"], kw["min_obs"])
        self.origin = val(con, "insert into harbours (company_id, name, lat, lng) values (%s, 'Test Harbour O', %s, %s) returning id",
                          self.company, ORIGIN[0], ORIGIN[1])
        self.other = val(con, "insert into harbours (company_id, name, lat, lng) values (%s, 'Test Harbour X', %s, %s) returning id",
                         self.company, OTHER[0], OTHER[1])
        self.vessel = val(con, "insert into vessels (company_id, name) values (%s, 'Speedboat 03') returning id", self.company)
        self.route = val(con, """insert into routes (company_id, name, origin, destination, duration_min, origin_harbour_id, destination_harbour_id)
                                 values (%s, 'O to D', 'Test Island O', 'Test Island D', 40, %s, %s) returning id""",
                         self.company, self.origin if harbours else None, self.dest if harbours else None)
        self.trip = val(con, """insert into trips (company_id, route_id, vessel_id, captain_id, status, depart_at, arrive_at, actual_depart, code)
                                values (%s, %s, %s, %s, %s, %s, %s, %s, 'TR-1') returning id""",
                        self.company, self.route, self.vessel, self.captain, status, SCHED_ARRIVE - timedelta(minutes=40),
                        SCHED_ARRIVE, SCHED_ARRIVE - timedelta(minutes=40))
        q(con, "insert into trip_crew (trip_id, company_id, user_id) values (%s, %s, %s), (%s, %s, %s)",
          self.trip, self.company, self.crew, self.trip, self.company, self.crew2)

    def fix(self, point, at, acc=10.0, now=None, source="followme", device="", client=None, speed=None, basis="device", received=None, trip=True):
        return val(self.con, "select arrival_ingest(%s, %s, %s, %s, %s, %s, null, %s, %s, %s, null, %s, %s, %s, %s)",
                   self.vessel, point[0] if point else None, point[1] if point else None, at, acc, speed, source, device, client,
                   basis, received, self.trip if trip else None, now or (at + timedelta(seconds=5) if at else T0))

    def state(self):
        return q1(self.con, "select * from trip_arrival_state where trip_id = %s", self.trip)

    def trip_row(self):
        return q1(self.con, "select * from trips where id = %s", self.trip)

    def events(self, current_only=True):
        return q(self.con, "select * from trip_arrival_events where trip_id = %s" + (" and superseded_at is null" if current_only else "")
                 + " order by confirmed_at", self.trip)


INSIDE = offset(DEST, 20)        # 20 m from the pin: well inside a 150 m zone
OUTSIDE_NEAR = offset(DEST, 600)  # approach zone
FAR = offset(DEST, 8000)


class PureFunctions(unittest.TestCase):
    @classmethod
    def setUpClass(cls):
        cls.con = connect()

    def test_haversine_one_degree_latitude(self):
        d = val(self.con, "select geo_distance_m(4, 73, 5, 73)")
        self.assertAlmostEqual(d, 111195, delta=5)

    def test_circle_zones_and_configurable_radius(self):
        h = '{"lat":4.1,"lng":73.5,"geofence_type":"circle","radius_m":%d,"approach_m":2000}'
        p = offset(DEST, 200)
        self.assertEqual(val(self.con, "select arrival_zone(%s::jsonb, %s, %s, 10)->>'zone'", h % 100, *p), "approach")
        self.assertEqual(val(self.con, "select arrival_zone(%s::jsonb, %s, %s, 10)->>'zone'", h % 300, *p), "inside")
        self.assertEqual(val(self.con, "select arrival_zone(%s::jsonb, %s, %s, 10)->>'zone'", h % 200, *p), "boundary")

    def test_boundary_uses_uncertainty(self):
        h = '{"lat":4.1,"lng":73.5,"geofence_type":"circle","radius_m":150,"approach_m":2000}'
        p = offset(DEST, 140)   # 140 m: inside by 10 m
        self.assertEqual(val(self.con, "select arrival_zone(%s::jsonb, %s, %s, 5)->>'zone'", h, *p), "inside")
        self.assertEqual(val(self.con, "select arrival_zone(%s::jsonb, %s, %s, 25)->>'zone'", h, *p), "boundary")
        p = offset(DEST, 160)   # outside by 10 m
        self.assertEqual(val(self.con, "select arrival_zone(%s::jsonb, %s, %s, 25)->>'zone'", h, *p), "boundary")
        self.assertEqual(val(self.con, "select arrival_zone(%s::jsonb, %s, %s, 5)->>'zone'", h, *p), "approach")

    def test_polygon_point_in_polygon_and_edge(self):
        sq = [list(offset(DEST, -100, -100)), list(offset(DEST, -100, 100)), list(offset(DEST, 100, 100)), list(offset(DEST, 100, -100))]
        poly = psycopg2.extras.Json(sq)
        r = q1(self.con, "select geo_polygon_eval(%s, %s, %s) e", poly, *DEST)["e"]
        self.assertTrue(r["inside"]); self.assertAlmostEqual(r["edge_m"], 100, delta=1)
        r = q1(self.con, "select geo_polygon_eval(%s, %s, %s) e", poly, *offset(DEST, 150))["e"]
        self.assertFalse(r["inside"]); self.assertAlmostEqual(r["edge_m"], 50, delta=1)
        h = psycopg2.extras.Json({"lat": DEST[0], "lng": DEST[1], "geofence_type": "polygon", "radius_m": 50, "polygon": sq, "approach_m": 2000})
        self.assertEqual(val(self.con, "select arrival_zone(%s, %s, %s, 10)->>'zone'", h, *offset(DEST, 80)), "inside")
        self.assertEqual(val(self.con, "select arrival_zone(%s, %s, %s, 10)->>'zone'", h, *offset(DEST, 130)), "approach")

    def test_followme_parsing(self):
        one = val(self.con, "select followme_position(%s, 'Speedboat 03')", '{"lat":"4.1","lon":"73.5","Speed(kn)":"3.2","updated":"2026-10-27 07:55:00"}')
        self.assertEqual((one["lat"], one["lng"], one["speed_kn"]), (4.1, 73.5, 3.2))
        many = '{"data":{"a":{"name":"Speedboat 03","lat":4.1,"lng":73.5},"b":{"name":"Ferry 1","lat":4.2,"lng":73.6}}}'
        self.assertEqual(val(self.con, "select followme_position(%s, 'Speedboat 03')->>'lat'", many), "4.1")
        self.assertEqual(val(self.con, "select followme_position(%s, 'Unknown boat')->>'error'", many), "ambiguous")
        self.assertEqual(val(self.con, "select followme_position('<html>share page</html>', 'x')->>'error'"), "not_json")

    def test_followme_time(self):
        fetched = T0
        r = val(self.con, "select followme_time('2026-10-27 07:49:30', 'Indian/Maldives', %s)", fetched)
        self.assertEqual(r["basis"], "device_local")
        self.assertEqual(datetime.fromisoformat(r["at"]), T0 - timedelta(seconds=30))
        self.assertEqual(val(self.con, "select followme_time(null, 'Indian/Maldives', %s)->>'basis'", fetched), "received")
        self.assertEqual(val(self.con, "select followme_time('2099-01-01T00:00:00Z', 'Indian/Maldives', %s)->>'basis'", fetched), "received")


class Harbours(unittest.TestCase):
    def setUp(self):
        self.con = connect()
        self.w = World(self.con)

    def test_overlapping_zone_refused_unless_allowed(self):
        near = offset(DEST, 200)
        with self.assertRaisesRegex(psycopg2.Error, "overlaps Test Harbour D"):
            q(self.con, "insert into harbours (company_id, name, lat, lng) values (%s, 'Jetty 2', %s, %s)", self.w.company, *near)
        q(self.con, "insert into harbours (company_id, name, lat, lng, allow_overlap) values (%s, 'Jetty 2', %s, %s, true)", self.w.company, *near)

    def test_duplicate_name_and_bad_values_refused(self):
        with self.assertRaises(psycopg2.Error):
            q(self.con, "insert into harbours (company_id, name, lat, lng) values (%s, 'test harbour d', 5.0, 72.0)", self.w.company)
        for lat, radius, min_obs in ((95, 150, 3), (5.0, 5, 3), (5.0, 150, 1)):   # bad latitude, radius, single-fix rule
            with self.assertRaises(psycopg2.Error):
                q(self.con, "insert into harbours (company_id, name, lat, lng, radius_m, min_obs) values (%s, 'Bad', %s, 72.0, %s, %s)",
                  self.w.company, lat, radius, min_obs)
        with self.assertRaisesRegex(psycopg2.Error, "pin inside its boundary"):
            sq = [list(offset((5.0, 72.0), 500, 500)), list(offset((5.0, 72.0), 500, 700)), list(offset((5.0, 72.0), 700, 700))]
            q(self.con, "insert into harbours (company_id, name, lat, lng, geofence_type, polygon) values (%s, 'Poly', 5.0, 72.0, 'polygon', %s)",
              self.w.company, psycopg2.extras.Json(sq))

    def test_trip_copies_route_harbours(self):
        t = self.w.trip_row()
        self.assertEqual((t["origin_harbour_id"], t["destination_harbour_id"]), (self.w.origin, self.w.dest))


class Arrival(unittest.TestCase):
    def setUp(self):
        self.con = connect()
        self.w = World(self.con)

    def arrive(self, start=T0):
        self.w.fix(OUTSIDE_NEAR, start - timedelta(seconds=30))
        for s in (0, 30, 60):
            r = self.w.fix(INSIDE, start + timedelta(seconds=s))
        return r

    # 1
    def test_arrives_at_destination_and_records_first_inside_fix(self):
        r = self.arrive()
        self.assertEqual(r["status"], "arrived")
        t = self.w.trip_row()
        self.assertEqual(t["status"], "Arrived")
        self.assertEqual(t["actual_arrive"], T0)                       # first fix inside, not the scheduled 08:00
        self.assertEqual(t["meta"]["arrival_source"], "gps_geofence")
        [e] = self.w.events()
        self.assertEqual(e["method"], "gps_geofence")
        self.assertEqual(e["arrived_at"], T0)
        self.assertEqual(e["arrived_after"], T0 - timedelta(seconds=30))
        self.assertEqual(e["uncertainty_s"], 30)
        self.assertEqual(e["confirmed_obs_at"], T0 + timedelta(seconds=60))
        self.assertEqual(e["evidence"]["fixes"], 3)
        self.assertEqual(e["algorithm_version"], "harbour-arrival/1.0")
        self.assertEqual(e["origin_harbour_id"], self.w.origin)
        self.assertEqual(e["destination_harbour_id"], self.w.dest)
        self.assertEqual(self.w.state()["state"], "ARRIVED")

    def test_two_fixes_are_not_enough(self):
        self.w.fix(INSIDE, T0)
        r = self.w.fix(INSIDE, T0 + timedelta(seconds=90))
        self.assertEqual(r["state"], "ARRIVAL_PENDING")
        self.assertEqual(self.w.events(), [])

    def test_three_fixes_need_the_dwell_time(self):
        for s in (0, 10, 20):
            r = self.w.fix(INSIDE, T0 + timedelta(seconds=s))
        self.assertEqual(r["state"], "ARRIVAL_PENDING")
        r = self.w.fix(INSIDE, T0 + timedelta(seconds=61))
        self.assertEqual(r["status"], "arrived")

    # 2
    def test_stays_outside(self):
        for s in range(0, 600, 30):
            r = self.w.fix(FAR, T0 + timedelta(seconds=s))
        self.assertEqual(r["state"], "NOT_APPROACHING")
        self.assertEqual(self.w.events(), [])

    # 3
    def test_passes_near_without_entering(self):
        for s, east in enumerate(range(-1000, 1001, 100)):
            r = self.w.fix(offset(DEST, 190, east), T0 + timedelta(seconds=30 * s))   # 190 m north at closest
        self.assertEqual(self.w.events(), [])
        self.assertIn(r["state"], ("APPROACHING_DESTINATION", "NOT_APPROACHING"))
        self.assertEqual(self.w.trip_row()["status"], "Departed")

    def test_sitting_on_the_boundary_never_confirms(self):
        for s in range(0, 600, 30):
            r = self.w.fix(offset(DEST, 155), T0 + timedelta(seconds=s), acc=20)
        self.assertEqual(r["state"], "APPROACHING_DESTINATION")
        self.assertEqual(self.w.events(), [])

    # 4
    def test_brief_entry_then_exit_resets(self):
        self.w.fix(INSIDE, T0)
        self.w.fix(INSIDE, T0 + timedelta(seconds=30))
        r = self.w.fix(OUTSIDE_NEAR, T0 + timedelta(seconds=60))
        self.assertEqual(r["state"], "APPROACHING_DESTINATION")
        r = self.w.fix(INSIDE, T0 + timedelta(seconds=90))
        self.assertEqual(r["state"], "ARRIVAL_PENDING")
        self.assertEqual(self.w.state()["pending_count"], 1)
        self.assertEqual(self.w.events(), [])
        kinds = [x["kind"] for x in q(self.con, "select kind from arrival_diagnostics where trip_id = %s order by id", self.w.trip)]
        self.assertIn("geofence_exit", kinds)
        # Stays: confirmed from the re-entry, not the first entry.
        self.w.fix(INSIDE, T0 + timedelta(seconds=120))
        self.w.fix(INSIDE, T0 + timedelta(seconds=150))
        self.assertEqual(self.w.events()[0]["arrived_at"], T0 + timedelta(seconds=90))

    # 5
    def test_origin_harbour_does_not_trigger(self):
        for s in range(0, 600, 30):
            r = self.w.fix(offset(ORIGIN, 10), T0 + timedelta(seconds=s))
        self.assertEqual(r["state"], "NOT_APPROACHING")
        self.assertEqual(self.w.events(), [])

    # 6
    def test_other_islands_harbour_does_not_trigger(self):
        for s in range(0, 600, 30):
            r = self.w.fix(offset(OTHER, 5), T0 + timedelta(seconds=s))
        self.assertEqual(r["state"], "APPROACHING_DESTINATION")   # 1.1 km away: approaching, never arrived
        self.assertEqual(self.w.events(), [])

    # 7
    def test_poor_accuracy_never_confirms(self):
        for s in range(0, 300, 30):
            r = self.w.fix(INSIDE, T0 + timedelta(seconds=s), acc=120)
        self.assertEqual(r["reason"], "poor_accuracy")
        self.assertEqual(self.w.events(), [])

    def test_missing_accuracy_is_not_treated_as_precise(self):
        q(self.con, "update harbours set max_accuracy_m = 20 where id = %s", self.w.dest)   # assumed 30 m > 20 m
        r = self.w.fix(INSIDE, T0, acc=None)
        self.assertEqual(r["reason"], "accuracy_unknown")
        # and with the default limit, the assumed 30 m makes a fix 130 m out "boundary", not "inside"
        q(self.con, "update harbours set max_accuracy_m = 50 where id = %s", self.w.dest)
        r = self.w.fix(offset(DEST, 130), T0 + timedelta(seconds=30), acc=None)
        self.assertEqual(r["zone"], "boundary")

    # 8
    def test_stale_duplicate_and_out_of_order(self):
        r = self.w.fix(INSIDE, T0, now=T0 + timedelta(minutes=20))
        self.assertEqual(r["reason"], "stale")
        self.w.fix(INSIDE, T0 + timedelta(seconds=30))
        self.assertEqual(self.w.fix(INSIDE, T0 + timedelta(seconds=30))["status"], "duplicate")
        self.assertEqual(self.w.fix(INSIDE, T0 + timedelta(seconds=10))["reason"], "out_of_order")
        self.assertEqual(self.w.state()["pending_count"], 1)
        self.assertEqual(val(self.con, "select count(*) from vessel_positions where trip_id = %s", self.w.trip), 3)  # duplicate not stored twice

    def test_implausible_jump_rejected_then_reanchors(self):
        self.w.fix(FAR, T0)
        self.assertEqual(self.w.fix(offset(DEST, 80000), T0 + timedelta(seconds=10))["reason"], "implausible_jump")
        self.assertEqual(self.w.fix(offset(DEST, 80000), T0 + timedelta(seconds=20))["reason"], "implausible_jump")
        self.assertEqual(self.w.fix(offset(DEST, 80000), T0 + timedelta(seconds=30))["status"], "ok")   # third: re-anchored

    def test_speeding_through_the_zone_holds_confirmation(self):
        for s in (0, 30, 60):
            r = self.w.fix(INSIDE, T0 + timedelta(seconds=s), speed=25)
        self.assertEqual(r["state"], "ARRIVAL_PENDING")
        r = self.w.fix(INSIDE, T0 + timedelta(seconds=90), speed=2)
        self.assertEqual(r["status"], "arrived")
        self.assertEqual(self.w.trip_row()["actual_arrive"], T0)

    # 9
    def test_missing_data(self):
        self.assertEqual(self.w.fix(INSIDE, None)["reason"], "missing_time")
        self.assertEqual(self.w.fix(None, T0)["reason"], "invalid_coordinates")
        self.assertEqual(self.w.fix((0.0, 0.0), T0 + timedelta(seconds=1))["reason"], "invalid_coordinates")
        self.assertEqual(self.w.fix((95.0, 73.0), T0 + timedelta(seconds=2))["reason"], "invalid_coordinates")
        n = val(self.con, "select arrival_sweep(%s, %s)", self.w.company, T0 + timedelta(minutes=10))
        self.assertEqual(n, 1)
        st = self.w.state()
        self.assertEqual(st["state"], "TRACKING_UNAVAILABLE")
        self.assertEqual(self.w.trip_row()["status"], "Departed")   # unavailable is never "arrived"

    # 10
    def test_cancelled_trip_ignored(self):
        q(self.con, "update trips set status = 'Cancelled' where id = %s", self.w.trip)
        for s in (0, 30, 60, 90):
            r = self.w.fix(INSIDE, T0 + timedelta(seconds=s))
        self.assertEqual(r["reason"], "trip_cancelled")
        self.assertEqual(self.w.events(), [])
        self.assertEqual(self.w.trip_row()["status"], "Cancelled")

    # 11
    def test_already_arrived_is_final(self):
        self.arrive()
        r = self.w.fix(FAR, T0 + timedelta(seconds=120))
        self.assertEqual(r["reason"], "already_arrived")
        for s in (150, 180, 210, 240):
            self.w.fix(INSIDE, T0 + timedelta(seconds=s))
        self.assertEqual(len(self.w.events(current_only=False)), 1)
        self.assertEqual(self.w.trip_row()["actual_arrive"], T0)

    # 12
    def test_several_crew_devices(self):
        # The public RPC checks freshness against the real clock, so these fixes are placed just before now.
        base = datetime.now(timezone.utc).replace(microsecond=0) - timedelta(seconds=120)
        cap, crew = connect(self.w.captain), connect(self.w.crew)
        call = "select ingest_vessel_position(%s, %s, %s, %s, 8, 0.5, null, %s, %s)"
        val(cap, call, self.w.trip, *offset(DEST, 600), base - timedelta(seconds=40), "phoneA", "a0")
        rs = []
        for i, (c, dev) in enumerate([(cap, "phoneA"), (crew, "phoneB"), (cap, "phoneA"), (crew, "phoneB")]):
            rs.append(val(c, call, self.w.trip, *offset(DEST, 15 + i), base + timedelta(seconds=25 * i), dev, "%s%d" % (dev, i)))
        self.assertEqual(rs[-1]["status"], "arrived", rs)
        [e] = self.w.events()
        self.assertEqual(e["method"], "crew_device_geofence")     # estimated (phones), not verified vessel GPS
        self.assertEqual(e["arrived_at"], base)
        # a replayed offline queue (same client ids) is ignored
        self.assertEqual(val(cap, call, self.w.trip, *offset(DEST, 15), base, "phoneA", "phoneA0")["status"], "duplicate")
        # someone not on the trip cannot feed it
        with self.assertRaisesRegex(psycopg2.Error, "captain or crew"):
            val(connect(self.w.outsider), call, self.w.trip, *INSIDE, base + timedelta(seconds=100), "x", "x1")
        # positions are not readable directly
        with self.assertRaises(psycopg2.Error):
            c = connect(self.w.captain); c.cursor().execute("set role authenticated"); c.cursor().execute("select * from vessel_positions")

    # 13
    def test_concurrent_confirmations_record_one_arrival(self):
        self.w.fix(INSIDE, T0)
        self.w.fix(INSIDE, T0 + timedelta(seconds=30))
        a, b = connect(), connect()
        a.autocommit = False; b.autocommit = False
        results = {}
        sql = "select arrival_ingest(%s, %s, %s, %s, 10, null, null, 'crew_device', %s, null, null, 'device', null, %s, %s)"
        val(a, sql, self.w.vessel, *INSIDE, T0 + timedelta(seconds=60), "devA", self.w.trip, T0 + timedelta(seconds=65))

        def second():
            results["b"] = val(b, sql, self.w.vessel, *offset(DEST, 21), T0 + timedelta(seconds=61), "devB", self.w.trip, T0 + timedelta(seconds=66))
            b.commit()
        th = threading.Thread(target=second); th.start()
        time.sleep(0.5)
        self.assertTrue(th.is_alive())     # b waits on the trip's row lock
        a.commit(); th.join(10)
        self.assertEqual(results["b"]["reason"], "already_arrived")
        self.assertEqual(len(self.w.events(current_only=False)), 1)
        with self.assertRaises(psycopg2.Error):   # and the unique index backs it up
            q(self.con, "insert into trip_arrival_events (company_id, trip_id, method, arrived_at) values (%s, %s, 'manual', now())",
              self.w.company, self.w.trip)

    # 14
    def test_early_and_late(self):
        ops = connect(self.w.ops)
        self.arrive(T0 + timedelta(minutes=5))               # 07:55 local, scheduled 08:00
        row = next(x for x in val(ops, "select ops_arrivals(%s, '2026-10-27')", self.w.company)["trips"] if x["trip_id"] == str(self.w.trip))
        self.assertEqual(row["delta_min"], -5)
        w2 = World(self.con)
        w2.fix(OUTSIDE_NEAR, SCHED_ARRIVE + timedelta(minutes=7) - timedelta(seconds=30))
        for s in (0, 30, 60):
            w2.fix(INSIDE, SCHED_ARRIVE + timedelta(minutes=7, seconds=s))
        ops2 = connect(w2.ops)
        row = next(x for x in val(ops2, "select ops_arrivals(%s, '2026-10-27')", w2.company)["trips"] if x["trip_id"] == str(w2.trip))
        self.assertEqual(row["delta_min"], 7)
        self.assertEqual(row["label"], "Arrived")

    # 15
    def test_destination_harbour_not_configured(self):
        w = World(self.con, harbours=False)
        for s in (0, 30, 60, 90):
            r = w.fix(INSIDE, T0 + timedelta(seconds=s))
        self.assertEqual(r["reason"], "no_destination_harbour")
        self.assertEqual(w.events(), [])
        ops = connect(w.ops)
        row = next(x for x in val(ops, "select ops_arrivals(%s, '2026-10-27')", w.company)["trips"] if x["trip_id"] == str(w.trip))
        self.assertEqual(row["label"], "Harbour not set")
        gaps = val(ops, "select harbour_config_gaps(%s)", w.company)
        [route] = gaps["routes"]
        self.assertEqual(route["destination_suggestions"], [{"id": str(w.dest), "name": "Test Harbour D"}])   # island name match
        self.assertIsNone(w.trip_row()["destination_harbour_id"])       # suggestion only, nothing assigned

    # 16
    def test_connectivity_lost_then_queue_delivered(self):
        self.w.fix(OUTSIDE_NEAR, T0 - timedelta(seconds=30))
        self.w.fix(INSIDE, T0)
        val(self.con, "select arrival_sweep(%s, %s)", self.w.company, T0 + timedelta(minutes=7))
        self.assertEqual(self.w.state()["state"], "TRACKING_UNAVAILABLE")
        self.assertEqual(self.w.trip_row()["status"], "Departed")
        late = T0 + timedelta(minutes=8)
        self.w.fix(INSIDE, T0 + timedelta(seconds=30), now=late, received=late, source="crew_device", device="q")
        r = self.w.fix(INSIDE, T0 + timedelta(seconds=60), now=late, received=late, source="crew_device", device="q")
        self.assertEqual(r["status"], "arrived")
        [e] = self.w.events()
        self.assertEqual(e["arrived_at"], T0)                          # observed time, not the time the queue arrived
        self.assertEqual(e["obs_received_at"], late)

    def test_connectivity_lost_too_long_stays_unconfirmed(self):
        self.w.fix(INSIDE, T0)
        late = T0 + timedelta(minutes=40)
        r = self.w.fix(INSIDE, T0 + timedelta(seconds=30), now=late, received=late)
        self.assertEqual(r["reason"], "stale")
        self.assertEqual(self.w.events(), [])

    # 17
    def test_late_fix_after_trip_progressed(self):
        ops = connect(self.w.ops)
        q(ops, "update trips set status = 'Arrived' where id = %s", self.w.trip)     # pressed by hand
        [e] = self.w.events()
        self.assertEqual(e["method"], "manual")
        q(ops, "update trips set status = 'Completed' where id = %s", self.w.trip)
        for s in (0, 30, 60, 90):
            r = self.w.fix(INSIDE, T0 + timedelta(seconds=s))
        self.assertEqual(r["reason"], "already_arrived")
        self.assertEqual(self.w.trip_row()["status"], "Completed")      # not reopened
        self.assertEqual(len(self.w.events(current_only=False)), 1)

    # 18
    def test_maldives_local_time_display(self):
        start = SCHED_ARRIVE                                         # 03:00 UTC = 08:00 in Malé (UTC+5)
        self.w.fix(OUTSIDE_NEAR, start - timedelta(seconds=30))
        for s in (0, 30, 60):
            self.w.fix(INSIDE, start + timedelta(seconds=s))
        ops = connect(self.w.ops)
        row = next(x for x in val(ops, "select ops_arrivals(%s, '2026-10-27')", self.w.company)["trips"] if x["trip_id"] == str(self.w.trip))
        self.assertEqual(row["local_arrival"], "08:00 on 27 October 2026")
        self.assertEqual(row["delta_min"], 0)
        title = val(self.con, "select title from notifications_sent where subject_id = %s", str(self.w.trip))
        self.assertEqual(title, "Speedboat 03 arrived at Test Harbour D at 08:00 on 27 October 2026.")

    # corrections and reopening
    def test_manual_correction_is_audited(self):
        self.arrive()
        ops = connect(self.w.ops)
        with self.assertRaisesRegex(psycopg2.Error, "Say why"):
            val(ops, "select correct_trip_arrival(%s, %s, '')", self.w.trip, T0 + timedelta(minutes=2))
        with self.assertRaisesRegex(psycopg2.Error, "Only Operations"):
            val(connect(self.w.crew), "select correct_trip_arrival(%s, %s, 'x')", self.w.trip, T0)
        val(ops, "select correct_trip_arrival(%s, %s, 'Captain log: alongside at 07:52')", self.w.trip, T0 + timedelta(minutes=2))
        evs = self.w.events(current_only=False)
        self.assertEqual([e["method"] for e in evs], ["gps_geofence", "manual_correction"])
        self.assertIsNotNone(evs[0]["superseded_at"])
        self.assertEqual(evs[1]["supersedes"], evs[0]["id"])
        self.assertEqual(evs[1]["created_by"], self.w.ops)
        self.assertEqual(self.w.trip_row()["actual_arrive"], T0 + timedelta(minutes=2))

    def test_reopened_by_hand_clears_arrival(self):
        self.arrive()
        q(connect(self.w.ops), "update trips set status = 'In transit' where id = %s", self.w.trip)
        self.assertEqual(self.w.events(), [])
        self.assertEqual(self.w.state()["state"], "NOT_APPROACHING")

    def test_detail_explains_pending(self):
        self.w.fix(INSIDE, T0)
        d = val(connect(self.w.ops), "select trip_arrival_detail(%s)", self.w.trip)
        self.assertEqual(d["state"]["state"], "ARRIVAL_PENDING")
        self.assertIn("1 of 3 fixes", d["state"]["reason"])
        self.assertEqual(d["fixes"][0]["validity"], "valid")
        self.assertEqual(d["harbour"]["name"], "Test Harbour D")


class ClockRules(unittest.TestCase):
    """ops_auto uses the real clock, so these trips are placed relative to now()."""

    def setUp(self):
        self.con = connect()

    def make(self, followme):
        w = World(self.con)
        now = datetime.now(timezone.utc)
        q(self.con, "update trips set depart_at = %s, arrive_at = %s, actual_depart = %s where id = %s",
          now - timedelta(hours=3), now - timedelta(hours=2), now - timedelta(hours=3), w.trip)
        if followme:
            q(self.con, "insert into followme_links (vessel_id, company_id, url) values (%s, %s, 'https://followme.mv/api/v5/public/test/')",
              w.vessel, w.company)
        return w

    def test_gps_trip_is_not_arrived_by_the_clock(self):
        w = self.make(followme=True)
        val(self.con, "select ops_auto(%s)", w.company)
        self.assertEqual(w.trip_row()["status"], "Departed")
        self.assertIsNone(w.trip_row()["actual_arrive"])
        task = q1(self.con, "select * from dispatch_tasks where trip_id = %s", w.trip)
        self.assertEqual(task["meta"]["kind"], "arrival_unconfirmed")
        val(self.con, "select ops_auto(%s)", w.company)
        self.assertEqual(val(self.con, "select count(*) from dispatch_tasks where trip_id = %s", w.trip), 1)

    def test_clock_fallback_when_opted_in_is_labelled(self):
        w = self.make(followme=True)
        q(self.con, """update companies set settings = '{"3_arrival_detection": {"clockFallback": true}}' where id = %s""", w.company)
        val(self.con, "select ops_auto(%s)", w.company)
        self.assertEqual(w.trip_row()["status"], "Arrived")
        [e] = w.events()
        self.assertEqual(e["method"], "schedule_fallback")

    def test_trip_without_tracking_keeps_old_clock_behaviour(self):
        w = self.make(followme=False)
        val(self.con, "select ops_auto(%s)", w.company)
        t = w.trip_row()
        self.assertEqual(t["status"], "Arrived")
        self.assertEqual(t["meta"]["arrival_source"], "schedule")
        self.assertEqual(w.events()[0]["method"], "schedule_fallback")

    def test_settings_are_clamped(self):
        w = World(self.con, settings={"3_arrival_detection": {"maxDelaySec": 5, "maxSpeedKn": "fast", "enabled": "yes"}})
        cfg = val(self.con, "select arrival_cfg(%s)", w.company)
        self.assertEqual(cfg["maxDelaySec"], 30)
        self.assertEqual(cfg["maxSpeedKn"], 60)
        self.assertIs(cfg["enabled"], True)



def track(points):
    """[(point, seconds, accuracy, speed, delay)] -> arrival_simulate track."""
    out = []
    for p in points:
        pt, t = p[0], p[1]
        out.append({"lat": pt[0], "lng": pt[1], "t": t, "accuracy_m": p[2] if len(p) > 2 else 10.0,
                    "speed_kn": p[3] if len(p) > 3 else None, "delay_s": p[4] if len(p) > 4 else 0})
    return psycopg2.extras.Json(out)


class ArrivalLab(unittest.TestCase):
    """0059: the simulator runs the live engine's functions without writing anything."""

    def setUp(self):
        self.con = connect(platform=True)
        self.w = World(self.con)

    def sim(self, points, rules=None):
        return val(self.con, "select arrival_simulate(%s, %s, %s, %s)", self.w.dest, track(points), psycopg2.extras.Json(rules or {}), T0)

    def test_platform_owner_only(self):
        con = connect(self.w.ops)
        for sql, args in (("select arrival_simulate(%s, '[]'::jsonb)", (self.w.dest,)),
                          ("select arrival_lab_trips(%s)", (self.w.company,)),
                          ("select arrival_lab_trip_track(%s)", (self.w.trip,))):
            with self.assertRaises(psycopg2.Error) as cm:
                val(con, sql, *args)
            self.assertIn("platform owner", str(cm.exception))

    def test_simulated_arrival_matches_live_engine(self):
        pts = [(OUTSIDE_NEAR, -30), (INSIDE, 0), (INSIDE, 30), (INSIDE, 60)]
        r = self.sim(pts)
        self.assertEqual(r["final_state"], "ARRIVED")
        self.assertEqual(r["arrival"]["fixes"], 3)
        self.assertEqual(r["arrival"]["uncertainty_s"], 30)
        self.assertEqual(r["arrival"]["local"], "07:50:00 on 27 October 2026")
        self.assertEqual([s["event"] for s in r["steps"]], ["none", "enter", "none", "confirmed"])
        self.assertEqual([s["state"] for s in r["steps"]], ["APPROACHING_DESTINATION", "ARRIVAL_PENDING", "ARRIVAL_PENDING", "ARRIVED"])
        # The same fixes through the live engine give the same arrival time.
        for p, s in pts:
            live = self.w.fix(p, T0 + timedelta(seconds=s))
        self.assertEqual(live["status"], "arrived")
        self.assertEqual(self.w.trip_row()["actual_arrive"], datetime.fromisoformat(r["arrival"]["arrived_at"]))

    def test_simulation_writes_nothing(self):
        self.sim([(INSIDE, 0), (INSIDE, 30), (INSIDE, 60)])
        self.assertEqual(val(self.con, "select count(*) from vessel_positions where trip_id = %s", self.w.trip), 0)
        self.assertEqual(val(self.con, "select count(*) from trip_arrival_events where trip_id = %s", self.w.trip), 0)
        self.assertEqual(val(self.con, "select count(*) from arrival_diagnostics where trip_id = %s", self.w.trip), 0)
        self.assertEqual(self.w.trip_row()["status"], "Departed")

    def test_what_if_rules_change_the_verdict(self):
        pts = [(INSIDE, 0), (INSIDE, 30), (INSIDE, 60)]
        self.assertEqual(self.sim(pts)["final_state"], "ARRIVED")
        self.assertEqual(self.sim(pts, {"harbour": {"min_obs": 4}})["final_state"], "ARRIVAL_PENDING")
        self.assertEqual(self.sim(pts, {"harbour": {"dwell_sec": 120}})["final_state"], "ARRIVAL_PENDING")
        self.assertNotEqual(self.sim(pts, {"harbour": {"radius_m": 20}})["final_state"], "ARRIVED")   # 20 m out on a 20 m edge
        # Overrides are clamped like the table: min_obs 1 becomes 2, so two fixes over 60 s confirm.
        r = self.sim([(INSIDE, 0), (INSIDE, 60)], {"harbour": {"min_obs": 1}})
        self.assertEqual(r["harbour"]["min_obs"], 2)
        self.assertEqual(r["final_state"], "ARRIVED")

    def test_rejections_explained(self):
        r = self.sim([(INSIDE, 0, 200), (INSIDE, 10, None), (INSIDE, 20, 10, None, 3600), (FAR, 30), (offset(DEST, 80000), 40)],
                     {"cfg": {"assumedAccuracyM": 80}})
        self.assertEqual([s["reject"] for s in r["steps"]], ["poor_accuracy", "accuracy_unknown", "stale", None, "implausible_jump"])
        self.assertTrue(r["steps"][1]["accuracy_assumed"])
        self.assertEqual(r["rejected"], 4)
        self.assertEqual(r["final_state"], "NOT_APPROACHING")

    def test_other_harbours_and_origin_never_trigger(self):
        r = self.sim([(offset(OTHER, 10), s) for s in (0, 30, 60, 90)])
        self.assertNotEqual(r["final_state"], "ARRIVED")
        self.assertIn("inside", [o["zone"] for o in r["steps"][0]["other_harbours"] if o["name"] == "Test Harbour X"])
        r = self.sim([(offset(ORIGIN, 10), s) for s in (0, 30, 60, 90)])
        self.assertEqual(r["final_state"], "NOT_APPROACHING")

    def test_draft_harbour_and_tracking_gap(self):
        rules = {"company": str(self.w.company), "harbour": {"lat": FAR[0], "lng": FAR[1], "radius_m": 100}}
        r = val(self.con, "select arrival_simulate(null, %s, %s, %s)", track([(FAR, 0), (FAR, 30), (FAR, 400), (FAR, 460)]),
                psycopg2.extras.Json(rules), T0)
        self.assertEqual(r["harbour"]["name"], "Draft harbour")
        self.assertTrue(r["steps"][2]["tracking_gap_before"])         # 370 s > trackingGapSec 300
        self.assertEqual(r["steps"][2]["event"], "reset_gap")         # and > maxGapSec 180: the streak restarted
        with self.assertRaises(psycopg2.Error):
            val(self.con, "select arrival_simulate(null, '[]'::jsonb, '{}'::jsonb)")

    def test_replay_a_recorded_trip(self):
        for p, s in ((OUTSIDE_NEAR, -30), (INSIDE, 0), (INSIDE, 30), (INSIDE, 60), (INSIDE, 90)):
            self.w.fix(p, T0 + timedelta(seconds=s))
        [trip] = val(self.con, "select arrival_lab_trips(%s)", self.w.company)
        self.assertEqual(trip["fixes"], 5)
        d = val(self.con, "select arrival_lab_trip_track(%s)", self.w.trip)
        self.assertEqual([f["t"] for f in d["track"]], [0, 30, 60, 90, 120])
        self.assertEqual(d["track"][-1]["live"]["validity"], "after_arrival")
        self.assertEqual(d["event"]["method"], "gps_geofence")
        r = val(self.con, "select arrival_simulate(%s, %s, '{}'::jsonb, %s)", self.w.dest, psycopg2.extras.Json(d["track"]),
                datetime.fromisoformat(d["start"]))
        self.assertEqual(datetime.fromisoformat(r["arrival"]["arrived_at"]), datetime.fromisoformat(d["event"]["arrived_at"]))
        self.assertEqual(r["steps"][-1]["reject"], "after_arrival")


NEW = (4.2000, 73.4500)   # a jetty nobody has drawn yet (open sea, synthetic)


class HarbourLearning(unittest.TestCase):
    """0060: stops → candidates → automatic harbours and route links, with undo."""

    def setUp(self):
        self.con = connect()
        self.w = World(self.con)
        self.boat = val(self.con, "insert into vessels (company_id, name) values (%s, 'Speedboat 07') returning id", self.w.company)
        self.route = val(self.con, """insert into routes (company_id, name, origin, destination) values (%s, 'O to N', 'Test Island O', 'Nova Island')
                                      returning id""", self.w.company)

    def trip(self, arrive, status="Arrived", route=None):
        return val(self.con, """insert into trips (company_id, route_id, vessel_id, status, depart_at, arrive_at, actual_depart, actual_arrive)
                                values (%s, %s, %s, %s, %s, %s, %s, %s) returning id""",
                   self.w.company, route or self.route, self.boat, status, arrive - timedelta(minutes=40), arrive,
                   arrive - timedelta(minutes=40), arrive if status == "Arrived" else None)

    def dwell(self, point, start, minutes=6, step=60, jitter=8):
        for i in range(minutes * 60 // step + 1):
            p = offset(point, (i % 3 - 1) * jitter, (i % 2) * jitter)
            q(self.con, """insert into vessel_positions (company_id, vessel_id, source, observed_at, received_at, lat, lng, validity)
                           values (%s, %s, 'followme', %s, %s, %s, %s, 'no_active_trip')""",
              self.w.company, self.boat, start + timedelta(seconds=i * step), start + timedelta(seconds=i * step + 5), p[0], p[1])

    def learn(self, now=None):
        return val(self.con, "select harbour_learn(%s, %s)", self.w.company, now or T0 + timedelta(days=3))

    def arrivals(self, days):
        for d in days:
            at = T0 + timedelta(days=d)
            self.trip(at)
            self.dwell(NEW, at + timedelta(minutes=1))

    def test_stop_detected_and_tied_to_the_arriving_trip(self):
        t = self.trip(T0)
        self.dwell(NEW, T0 + timedelta(minutes=1))
        self.dwell(offset(NEW, 3000), T0 + timedelta(minutes=30), minutes=2)     # too short to be a stop
        self.learn()
        [s] = q(self.con, "select * from vessel_stops where vessel_id = %s", self.boat)
        self.assertEqual(s["arrive_trip_id"], t)
        self.assertEqual(s["arrive_route_id"], self.route)
        self.assertLess(val(self.con, "select geo_distance_m(%s, %s, %s, %s)", s["lat"], s["lng"], NEW[0], NEW[1]), 15)
        self.assertGreaterEqual(s["fixes"], 6)

    def test_learns_a_harbour_and_links_the_route(self):
        self.arrivals([0, 1, 2])
        r = self.learn()
        self.assertEqual(r["harbours_created"], 1)
        h = q1(self.con, "select * from harbours where company_id = %s and meta->>'auto' = 'true'", self.w.company)
        self.assertEqual(h["name"], "Nova Island")
        self.assertEqual(val(self.con, "select name from islands where id = %s", h["island_id"]), "Nova Island")
        self.assertTrue(60 <= h["radius_m"] <= 400)
        self.assertLess(val(self.con, "select geo_distance_m(%s, %s, %s, %s)", h["lat"], h["lng"], NEW[0], NEW[1]), 15)
        self.assertEqual(val(self.con, "select destination_harbour_id from routes where id = %s", self.route), h["id"])
        self.assertIsNone(val(self.con, "select origin_harbour_id from routes where id = %s", self.route))
        kinds = [x["kind"] for x in q(self.con, "select kind from harbour_learning_log where company_id = %s order by id", self.w.company)]
        self.assertEqual(kinds, ["harbour_created", "route_linked"])
        # Open trips on the route follow the new link.
        t = self.trip(T0 + timedelta(days=4), status="Scheduled")
        self.assertEqual(val(self.con, "select destination_harbour_id from trips where id = %s", t), h["id"])

    def test_not_enough_evidence_stays_a_candidate(self):
        self.arrivals([0, 0.1])                                                  # two stops, one day
        r = self.learn()
        self.assertEqual(r["harbours_created"], 0)
        [c] = q(self.con, "select * from harbour_candidates where company_id = %s", self.w.company)
        self.assertEqual((c["status"], c["stops"], c["days"]), ("learning", 2, 1))
        st = val(connect(self.w.ops), "select harbour_learning_status(%s)", self.w.company)
        self.assertLess(st["candidates"][0]["progress"], 1)

    def test_mooring_without_trips_is_never_made_a_harbour(self):
        for d in (0, 1, 2, 3):
            self.dwell(NEW, T0 + timedelta(days=d, hours=12), minutes=20)         # overnight, no trip near
        self.assertEqual(self.learn()["harbours_created"], 0)
        self.assertEqual(val(self.con, "select trip_stops from harbour_candidates where company_id = %s", self.w.company), 0)

    def test_stops_at_a_known_harbour_link_routes_by_gps(self):
        r2 = val(self.con, "insert into routes (company_id, name, origin, destination) values (%s, 'X to D', 'Somewhere', 'Elsewhere') returning id",
                 self.w.company)
        for d in (0, 1):
            at = T0 + timedelta(days=d)
            self.trip(at, route=r2)
            self.dwell(offset(DEST, 30), at + timedelta(minutes=1))
        self.learn()
        self.assertEqual(val(self.con, "select destination_harbour_id from routes where id = %s", r2), self.w.dest)
        self.assertEqual(val(self.con, "select count(*) from harbours where company_id = %s", self.w.company), 3)   # nothing new

    def test_name_link_when_no_gps(self):
        r3 = val(self.con, "insert into routes (company_id, name, origin, destination) values (%s, 'D to X', 'test harbour d', 'TEST HARBOUR X') returning id",
                 self.w.company)
        self.learn()
        row = q1(self.con, "select * from routes where id = %s", r3)
        self.assertEqual((row["origin_harbour_id"], row["destination_harbour_id"]), (self.w.dest, self.w.other))
        self.assertEqual(val(self.con, "select count(*) from harbour_learning_log where route_id = %s and method = 'name'", r3), 2)

    def test_manual_links_are_never_overwritten(self):
        q(self.con, "update routes set destination_harbour_id = %s where id = %s", self.w.other, self.route)
        self.arrivals([0, 1, 2])
        self.learn()
        self.assertEqual(val(self.con, "select destination_harbour_id from routes where id = %s", self.route), self.w.other)

    def test_undo_harbour_removes_it_and_never_relearns(self):
        self.arrivals([0, 1, 2])
        self.learn()
        log = val(self.con, "select id from harbour_learning_log where kind = 'harbour_created' and company_id = %s", self.w.company)
        ops = connect(self.w.ops)
        r = val(ops, "select harbour_learning_undo(%s)", log)
        self.assertIn("removed", r["message"])
        self.assertEqual(val(self.con, "select count(*) from harbours where company_id = %s and meta->>'auto' = 'true'", self.w.company), 0)
        row = q1(self.con, "select * from routes where id = %s", self.route)
        self.assertIsNone(row["destination_harbour_id"])
        self.assertTrue(row["meta"]["auto_off_destination"])
        self.arrivals([3])
        self.assertEqual(self.learn(T0 + timedelta(days=5))["harbours_created"], 0)
        self.assertEqual(val(self.con, "select status from harbour_candidates where company_id = %s", self.w.company), "dismissed")
        with self.assertRaises(psycopg2.Error):
            val(ops, "select harbour_learning_undo(%s)", log)                     # already undone

    def test_undo_route_link_is_not_made_again(self):
        self.arrivals([0, 1, 2])
        self.learn()
        log = val(self.con, "select id from harbour_learning_log where kind = 'route_linked' and company_id = %s", self.w.company)
        val(connect(self.w.ops), "select harbour_learning_undo(%s)", log)
        self.learn(T0 + timedelta(days=4))
        self.assertIsNone(val(self.con, "select destination_harbour_id from routes where id = %s", self.route))
        self.assertEqual(val(self.con, "select count(*) from harbours where company_id = %s and meta->>'auto' = 'true'", self.w.company), 1)

    def test_learning_can_be_switched_off(self):
        q(self.con, "update companies set settings = %s where id = %s", psycopg2.extras.Json({"3_arrival_detection": {"autoLearn": False}}), self.w.company)
        self.arrivals([0, 1, 2])
        self.assertIn("skipped", self.learn())
        self.assertEqual(val(self.con, "select count(*) from harbours where company_id = %s", self.w.company), 3)

    def test_rerun_is_stable(self):
        self.arrivals([0, 1, 2])
        self.learn()
        before = val(self.con, "select count(*) from vessel_stops where vessel_id = %s", self.boat)
        r = self.learn(T0 + timedelta(days=3, minutes=10))
        self.assertEqual((r["harbours_created"], r["routes_linked"]), (0, 0))
        self.assertEqual(val(self.con, "select count(*) from vessel_stops where vessel_id = %s", self.boat), before)

    def test_only_operations_see_or_run_learning(self):
        out = connect(self.w.outsider)
        for sql in ("select harbour_learning_status(%s)", "select harbour_learn_now(%s)"):
            with self.assertRaises(psycopg2.Error):
                val(out, sql, self.w.company)
        st = val(connect(self.w.ops), "select harbour_learn_now(%s)", self.w.company)
        self.assertIn("candidates", st)


if __name__ == "__main__":
    unittest.main()
