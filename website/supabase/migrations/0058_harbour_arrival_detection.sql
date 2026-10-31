-- Automatic harbour arrival detection (Claude, 27 Oct 2026). Applies after 0057 (Cursor's 0055–0057).
--
-- What it adds
--  1. Harbour registry: islands + harbours (circle or polygon geofence, accuracy / dwell / fix-count rules per harbour).
--     Routes and trips point at an origin and a destination harbour. Nothing is guessed for existing routes:
--     harbour_config_gaps() lists the routes that still need harbours (with name-match suggestions only).
--  2. vessel_positions: every raw GPS fix kept as received (validity, zone, distance), deduplicated.
--  3. Arrival engine as pure SQL functions (geo_distance_m, geo_polygon_eval, arrival_zone, arrival_check_obs,
--     arrival_step) so the rules are deterministic and testable, and arrival_ingest() which validates a fix, locks the
--     trip's trip_arrival_state row, runs the step and — once confirmed — writes ONE trip_arrival_events row
--     (unique per trip) and sets trips.status = 'Arrived', trips.actual_arrive = first fix inside the zone.
--  4. Feeds: the every-minute ops_tick → ops_auto → arrival_sweep() polls FollowMe for vessels under way (same one
--     outside call per company per minute as followme_fetch), and ingest_vessel_position() lets the captain/crew of a
--     trip send phone fixes (stored as crew_device = estimated vessel position).
--  5. ops_auto: trips that GPS can judge (destination harbour set + a tracking source) are no longer marked Arrived at
--     the scheduled time. If GPS has not confirmed arrival `fallbackAfterMin` after the arrival time, Operations get a
--     High dispatch task (or, with clockFallback = true, the old clock arrival, labelled schedule_fallback).
--     Trips without harbours/tracking keep the old clock behaviour unchanged.
--  6. Manual Arrived (set_trip_status) and correct_trip_arrival() write audited arrival events; reopening a trip by
--     hand supersedes its arrival. Late GPS never reopens or overwrites an arrival.
--  7. Read models: ops_arrivals() for the Operations dashboard, trip_arrival_detail() for "why arrived / why pending",
--     harbour_test_point() to test a point against a geofence.
--
-- Settings (Operations may edit 3_ keys): 3_arrival_detection, see arrival_cfg() for keys, defaults and limits.
-- States (trip_arrival_state.state): NOT_APPROACHING, APPROACHING_DESTINATION, ARRIVAL_PENDING, ARRIVED,
-- TRACKING_UNAVAILABLE. These describe tracking only; trips.status stays the trip lifecycle (Arrived is set once).

-- 0. Version and settings ------------------------------------------------------------------------------------------
create or replace function arrival_algorithm_version() returns text
  language sql immutable as $$ select 'harbour-arrival/1.0' $$;

-- Company arrival settings merged over defaults; numbers are clamped to safe ranges.
create or replace function arrival_cfg(p_company uuid) returns jsonb
  language plpgsql stable security definer set search_path = public as
$$ declare
  s jsonb; k text; v numeric; out jsonb;
  d constant jsonb := jsonb_build_object(
    'enabled', true,            -- arrival detection on
    'assumedAccuracyM', 30,     -- accuracy used when a fix has none (missing accuracy is never treated as precise)
    'maxDelaySec', 900,         -- a fix older than this when it reaches the server is stale
    'maxFutureSec', 60,         -- clock skew allowed for fixes "from the future"
    'maxGapSec', 180,           -- longest gap between fixes inside the zone before the dwell restarts
    'trackingGapSec', 300,      -- no usable fix for this long while under way → TRACKING_UNAVAILABLE
    'maxSpeedKn', 60,           -- faster implied movement between fixes is an implausible jump
    'passThroughKn', 12,        -- reported speed above this inside the zone holds confirmation (0 = ignore speed)
    'clockFallback', false,     -- true: old clock arrival when GPS never confirms (labelled schedule_fallback)
    'fallbackAfterMin', 60,     -- minutes after arrival time before the fallback / Ops task
    'completeBookings', false,  -- true: GPS arrival also completes bookings like the clock arrival does
    'allowCrewDevices', true,   -- accept crew phone fixes (estimated position)
    'retentionDays', 30);       -- raw fixes and diagnostics kept this long
  lim constant jsonb := '{"assumedAccuracyM":[5,500],"maxDelaySec":[30,86400],"maxFutureSec":[0,600],"maxGapSec":[30,3600],
    "trackingGapSec":[60,7200],"maxSpeedKn":[10,120],"passThroughKn":[0,60],"fallbackAfterMin":[5,1440],"retentionDays":[1,365]}';
begin
  s := company_setting(p_company, '3_arrival_detection');
  if s is null or jsonb_typeof(s) <> 'object' then s := '{}'::jsonb; end if;
  out := d;
  for k in select jsonb_object_keys(d) loop
    continue when not s ? k;
    if lim ? k then
      begin v := (s->>k)::numeric; exception when others then v := null; end;
      if v is not null then
        out := out || jsonb_build_object(k, greatest((lim->k->>0)::numeric, least((lim->k->>1)::numeric, v)));
      end if;
    elsif jsonb_typeof(s->k) = 'boolean' then
      out := out || jsonb_build_object(k, s->k);
    end if;
  end loop;
  return out || jsonb_build_object('version', arrival_algorithm_version());
end $$;
revoke execute on function arrival_cfg(uuid) from anon, public;
grant execute on function arrival_cfg(uuid) to authenticated;

-- 1. Geometry (no PostGIS in this project) --------------------------------------------------------------------------
-- Great-circle distance in metres (Haversine, mean Earth radius).
create or replace function geo_distance_m(lat1 float8, lng1 float8, lat2 float8, lng2 float8) returns float8
  language sql immutable strict parallel safe as
$$ select 2 * 6371008.8 * asin(least(1, sqrt(power(sin(radians(lat2 - lat1) / 2), 2)
          + cos(radians(lat1)) * cos(radians(lat2)) * power(sin(radians(lng2 - lng1) / 2), 2)))) $$;

-- Point in polygon (ray casting) and distance to the nearest edge, in a local metric projection centred on the point
-- (accurate for harbour-sized shapes). Polygon = [[lat,lng], ...]. Returns {inside, edge_m}.
create or replace function geo_polygon_eval(p_poly jsonb, p_lat float8, p_lng float8) returns jsonb
  language plpgsql immutable parallel safe as
$$ declare n int; i int; j int; xi float8; yi float8; xj float8; yj float8; dx float8; dy float8; t float8; d float8;
  inside boolean := false; best float8; k constant float8 := 6371008.8 * pi() / 180; c float8 := cos(radians(p_lat));
begin
  n := jsonb_array_length(p_poly);
  if n < 3 then return jsonb_build_object('inside', false, 'edge_m', null); end if;
  j := n - 1;
  for i in 0 .. n - 1 loop
    xi := ((p_poly->i->>1)::float8 - p_lng) * c * k; yi := ((p_poly->i->>0)::float8 - p_lat) * k;
    xj := ((p_poly->j->>1)::float8 - p_lng) * c * k; yj := ((p_poly->j->>0)::float8 - p_lat) * k;
    if (yi > 0) <> (yj > 0) and 0 < (xj - xi) * (0 - yi) / (yj - yi) + xi then inside := not inside; end if;
    dx := xj - xi; dy := yj - yi;
    t := case when dx = 0 and dy = 0 then 0 else greatest(0, least(1, -(xi * dx + yi * dy) / (dx * dx + dy * dy))) end;
    d := sqrt(power(xi + t * dx, 2) + power(yi + t * dy, 2));
    if best is null or d < best then best := d; end if;
    j := i;
  end loop;
  return jsonb_build_object('inside', inside, 'edge_m', best);
end $$;

-- How far a zone reaches from its pin (circle radius, or farthest polygon corner). Used for overlap checks.
create or replace function harbour_reach_m(p_type text, p_radius float8, p_poly jsonb, p_lat float8, p_lng float8) returns float8
  language sql immutable as
$$ select case when p_type = 'polygon' and jsonb_typeof(p_poly) = 'array'
           then (select max(geo_distance_m(p_lat, p_lng, (e->>0)::float8, (e->>1)::float8)) from jsonb_array_elements(p_poly) e)
           else p_radius end $$;

-- 2. Harbour registry ------------------------------------------------------------------------------------------------
create table islands (
  id         uuid primary key default gen_random_uuid(),
  company_id uuid not null references companies(id) on delete cascade,
  name       text not null check (char_length(btrim(name)) between 2 and 80),
  atoll      text check (atoll is null or char_length(atoll) <= 80),
  meta       jsonb not null default '{}'::jsonb check (jsonb_typeof(meta) = 'object' and pg_column_size(meta) <= 16384),
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now()
);
create unique index islands_name_key on islands (company_id, lower(btrim(name)));
alter table islands enable row level security;
create policy isl_select on islands for select to authenticated using (is_company_member(company_id));
create policy isl_write on islands for all to authenticated using (is_company_ops(company_id)) with check (is_company_ops(company_id));

create table harbours (
  id             uuid primary key default gen_random_uuid(),
  company_id     uuid not null references companies(id) on delete cascade,
  island_id      uuid references islands(id) on delete restrict,
  name           text not null check (char_length(btrim(name)) between 2 and 80),
  code           text check (code is null or code ~ '^[A-Z0-9_-]{1,12}$'),
  lat            double precision not null check (lat between -90 and 90),
  lng            double precision not null check (lng between -180 and 180),
  geofence_type  text not null default 'circle' check (geofence_type in ('circle', 'polygon')),
  radius_m       integer not null default 150 check (radius_m between 20 and 3000),
  polygon        jsonb check (polygon is null or jsonb_typeof(polygon) = 'array'),
  approach_m     integer not null default 2000 check (approach_m between 200 and 50000),
  max_accuracy_m integer not null default 50 check (max_accuracy_m between 5 and 500),  -- fixes less accurate than this never count
  dwell_sec      integer not null default 60 check (dwell_sec between 0 and 3600),      -- time inside before arrival is confirmed
  min_obs        integer not null default 3 check (min_obs between 2 and 50),           -- valid fixes inside (never one point)
  allow_overlap  boolean not null default false,
  active         boolean not null default true,
  meta           jsonb not null default '{}'::jsonb check (jsonb_typeof(meta) = 'object' and pg_column_size(meta) <= 16384),
  created_by     uuid references auth.users(id) on delete set null,
  updated_by     uuid references auth.users(id) on delete set null,
  created_at     timestamptz not null default now(),
  updated_at     timestamptz not null default now(),
  check (not (lat = 0 and lng = 0)),
  check (geofence_type = 'circle' or polygon is not null),
  check (approach_m > radius_m)
);
create unique index harbours_name_key on harbours (company_id, lower(btrim(name)));
create unique index harbours_code_key on harbours (company_id, code) where code is not null;
create index on harbours (company_id) where active;
alter table harbours enable row level security;
create policy hbr_select on harbours for select to authenticated using (is_company_member(company_id));
create policy hbr_write on harbours for all to authenticated using (is_company_ops(company_id)) with check (is_company_ops(company_id));

create or replace function harbours_guard() returns trigger
  language plpgsql security definer set search_path = public as
$$ declare n int; i int; p jsonb; la float8; lo float8; o record; reach float8; d float8;
begin
  new.name := btrim(new.name);
  new.code := nullif(upper(btrim(coalesce(new.code, ''))), '');
  new.updated_at := now();
  if tg_op = 'UPDATE' then
    new.company_id := old.company_id; new.created_at := old.created_at; new.created_by := old.created_by;
    new.updated_by := coalesce(auth.uid(), new.updated_by);
  else
    new.created_by := coalesce(new.created_by, auth.uid());
  end if;
  if new.island_id is not null and not exists (select 1 from islands where id = new.island_id and company_id = new.company_id) then
    raise exception 'Choose one of your islands.';
  end if;
  if new.geofence_type = 'polygon' then
    n := jsonb_array_length(new.polygon);
    if n < 3 or n > 100 then raise exception 'A harbour boundary needs 3 to 100 corner points.'; end if;
    for i in 0 .. n - 1 loop
      p := new.polygon->i;
      if jsonb_typeof(p) <> 'array' or jsonb_array_length(p) <> 2 then raise exception 'Boundary point % must be [latitude, longitude].', i + 1; end if;
      begin la := (p->>0)::float8; lo := (p->>1)::float8;
      exception when others then raise exception 'Boundary point % is not a number.', i + 1; end;
      if la is null or lo is null or la not between -90 and 90 or lo not between -180 and 180 then raise exception 'Boundary point % is out of range.', i + 1; end if;
      if geo_distance_m(new.lat, new.lng, la, lo) > 3000 then raise exception 'Boundary point % is more than 3 km from the harbour pin.', i + 1; end if;
    end loop;
    if not (geo_polygon_eval(new.polygon, new.lat, new.lng)->>'inside')::boolean then raise exception 'Put the harbour pin inside its boundary.'; end if;
  end if;
  -- Overlapping active zones would make "which harbour is this?" ambiguous: refuse unless explicitly allowed.
  if new.active and not new.allow_overlap then
    perform pg_advisory_xact_lock(hashtext('harbours:' || new.company_id::text));
    reach := harbour_reach_m(new.geofence_type, new.radius_m, new.polygon, new.lat, new.lng);
    for o in select * from harbours h where h.company_id = new.company_id and h.active and h.id <> new.id loop
      d := geo_distance_m(new.lat, new.lng, o.lat, o.lng);
      if d < reach + harbour_reach_m(o.geofence_type, o.radius_m, o.polygon, o.lat, o.lng) then
        raise exception 'This zone overlaps % (pins % m apart). Make the zones smaller, or tick "Allow overlap" if they really share water.', o.name, round(d::numeric);
      end if;
    end loop;
  end if;
  return new;
end $$;
create trigger hbr_guard before insert or update on harbours for each row execute function harbours_guard();

-- 3. Routes and trips point at harbours ------------------------------------------------------------------------------
alter table routes
  add column origin_harbour_id      uuid references harbours(id) on delete restrict,
  add column destination_harbour_id uuid references harbours(id) on delete restrict;
alter table routes add constraint routes_harbours_differ
  check (origin_harbour_id is null or destination_harbour_id is null or origin_harbour_id <> destination_harbour_id);

alter table trips
  add column origin_harbour_id      uuid references harbours(id) on delete restrict,
  add column destination_harbour_id uuid references harbours(id) on delete restrict;
create index trips_dest_harbour_idx on trips (destination_harbour_id) where destination_harbour_id is not null;
-- The only lookup per GPS fix: the vessel's trip that is under way.
create index trips_underway_vessel_idx on trips (vessel_id, depart_at desc) where status in ('Departed', 'In transit');

create or replace function routes_harbours_guard() returns trigger
  language plpgsql security definer set search_path = public as
$$ begin
  if new.origin_harbour_id is not null and not exists (select 1 from harbours where id = new.origin_harbour_id and company_id = new.company_id) then
    raise exception 'Choose one of your harbours for the origin.';
  end if;
  if new.destination_harbour_id is not null and not exists (select 1 from harbours where id = new.destination_harbour_id and company_id = new.company_id) then
    raise exception 'Choose one of your harbours for the destination.';
  end if;
  return new;
end $$;
create trigger rte_harbours_guard before insert or update of origin_harbour_id, destination_harbour_id on routes
  for each row execute function routes_harbours_guard();

-- Trips copy the route's harbours when created or moved to another route; explicit ones must be the company's.
create or replace function trips_harbours_fill() returns trigger
  language plpgsql security definer set search_path = public as
$$ declare o uuid; d uuid;
begin
  if tg_op = 'INSERT' or new.route_id is distinct from old.route_id then
    select origin_harbour_id, destination_harbour_id into o, d from routes where id = new.route_id;
    if tg_op = 'UPDATE' or new.origin_harbour_id is null then new.origin_harbour_id := o; end if;
    if tg_op = 'UPDATE' or new.destination_harbour_id is null then new.destination_harbour_id := d; end if;
  end if;
  if new.origin_harbour_id is not null and not exists (select 1 from harbours where id = new.origin_harbour_id and company_id = new.company_id) then
    raise exception 'Choose one of your harbours for the origin.';
  end if;
  if new.destination_harbour_id is not null and not exists (select 1 from harbours where id = new.destination_harbour_id and company_id = new.company_id) then
    raise exception 'Choose one of your harbours for the destination.';
  end if;
  return new;
end $$;
create trigger trp_harbours_fill before insert or update of route_id, origin_harbour_id, destination_harbour_id on trips
  for each row execute function trips_harbours_fill();

-- When a route gets (or changes) harbours, open trips follow. Trips already under way only get a harbour if they had none.
create or replace function routes_harbours_sync() returns trigger
  language plpgsql security definer set search_path = public as
$$ begin
  if new.origin_harbour_id is not distinct from old.origin_harbour_id and new.destination_harbour_id is not distinct from old.destination_harbour_id then
    return null;
  end if;
  update trips set origin_harbour_id = new.origin_harbour_id, destination_harbour_id = new.destination_harbour_id
    where route_id = new.id and not trip_closed(status)
      and (status not in ('Departed', 'In transit') or destination_harbour_id is null);
  return null;
end $$;
create trigger rte_harbours_sync after update of origin_harbour_id, destination_harbour_id on routes
  for each row execute function routes_harbours_sync();

-- 4. GPS observations, tracking state, arrival events, diagnostics --------------------------------------------------
create table vessel_positions (
  id          bigint generated always as identity primary key,
  company_id  uuid not null references companies(id) on delete cascade,
  vessel_id   uuid not null references vessels(id) on delete cascade,
  trip_id     uuid references trips(id) on delete set null,
  source      text not null check (source in ('followme', 'crew_device')),
  device_ref  text not null default '' check (char_length(device_ref) <= 64),   -- hashed, never a raw device id
  client_ref  text check (client_ref is null or char_length(client_ref) <= 64), -- the phone's own id for a queued fix
  reported_by uuid references auth.users(id) on delete set null,
  observed_at timestamptz,                                                       -- when the fix was taken (GPS / device)
  received_at timestamptz not null default now(),                                -- when the server got it
  time_basis  text not null default 'device' check (time_basis in ('device', 'device_local', 'received')),
  lat         double precision,
  lng         double precision,
  accuracy_m  real,
  speed_kn    real,
  heading     real,
  validity    text not null default 'pending',  -- valid or why not (stale, out_of_order, poor_accuracy, …)
  zone        text,                             -- inside / boundary / approach / outside (valid fixes only)
  distance_m  real,                             -- to the destination harbour pin
  meta        jsonb not null default '{}'::jsonb check (jsonb_typeof(meta) = 'object' and pg_column_size(meta) <= 4096)
);
create unique index vpos_dedupe on vessel_positions (vessel_id, source, device_ref, observed_at) where observed_at is not null;
create unique index vpos_client on vessel_positions (vessel_id, source, device_ref, client_ref) where client_ref is not null;
create index vpos_trip on vessel_positions (trip_id, observed_at desc);
create index vpos_received on vessel_positions (company_id, received_at);
alter table vessel_positions enable row level security;
revoke all on vessel_positions from anon, authenticated, public;   -- read through trip_arrival_detail() only

create table trip_arrival_state (
  trip_id                uuid primary key references trips(id) on delete cascade,
  company_id             uuid not null references companies(id) on delete cascade,
  vessel_id              uuid,
  destination_harbour_id uuid,
  state                  text not null default 'NOT_APPROACHING' check (state in
                           ('NOT_APPROACHING', 'APPROACHING_DESTINATION', 'ARRIVAL_PENDING', 'ARRIVED', 'TRACKING_UNAVAILABLE')),
  reason                 text,
  pending_since          timestamptz,   -- first valid fix inside the zone in the current streak
  pending_count          integer not null default 0,
  pending_first_obs      bigint,
  entry_after            timestamptz,   -- last fix not inside before the streak: the vessel entered between this and pending_since
  last_inside_at         timestamptz,
  last_not_inside_at     timestamptz,
  last_obs_id            bigint,
  last_obs_at            timestamptz,   -- last valid fix (observed time)
  last_received_at       timestamptz,   -- when the last valid fix reached the server
  last_any_received_at   timestamptz,   -- any fix, valid or not
  last_lat               double precision,
  last_lng               double precision,
  last_accuracy_m        real,
  last_zone              text,
  last_distance_m        real,
  last_source            text,
  jump_rejects           integer not null default 0,
  accepted               integer not null default 0,
  rejected               integer not null default 0,
  updated_at             timestamptz not null default now()
);
create index on trip_arrival_state (company_id, state);
alter table trip_arrival_state enable row level security;
create policy tas_select on trip_arrival_state for select to authenticated using (is_company_member(company_id));

create table trip_arrival_events (
  id                     uuid primary key default gen_random_uuid(),
  company_id             uuid not null references companies(id) on delete cascade,
  trip_id                uuid not null references trips(id) on delete cascade,
  vessel_id              uuid,
  origin_harbour_id      uuid,
  destination_harbour_id uuid,
  method                 text not null check (method in ('gps_geofence', 'crew_device_geofence', 'manual', 'manual_correction', 'schedule_fallback')),
  arrived_at             timestamptz not null,  -- actual arrival recorded on the trip
  arrived_after          timestamptz,           -- earliest possible entry (last fix outside); null = unknown
  uncertainty_s          integer,               -- arrived_at - arrived_after
  time_basis             text,                  -- device / device_local / received / manual / schedule
  confirmed_obs_at       timestamptz,           -- observed time of the fix that completed the confirmation
  obs_received_at        timestamptz,           -- when that fix reached the server
  confirmed_at           timestamptz not null default now(),  -- when the server confirmed and saved the arrival
  lat                    double precision,      -- first fix inside the zone
  lng                    double precision,
  accuracy_m             real,
  evidence               jsonb not null default '{}'::jsonb,
  algorithm_version      text,
  reason                 text check (reason is null or char_length(reason) <= 300),
  created_by             uuid references auth.users(id) on delete set null,
  supersedes             uuid references trip_arrival_events(id) on delete set null,
  superseded_at          timestamptz,
  superseded_by          uuid,
  meta                   jsonb not null default '{}'::jsonb
);
-- One current arrival per trip: concurrent confirmations cannot both win.
create unique index trip_arrival_current on trip_arrival_events (trip_id) where superseded_at is null;
create index on trip_arrival_events (company_id, confirmed_at desc);
alter table trip_arrival_events enable row level security;
create policy tae_select on trip_arrival_events for select to authenticated using (is_company_member(company_id));

create table arrival_diagnostics (
  id         bigint generated always as identity primary key,
  company_id uuid not null references companies(id) on delete cascade,
  trip_id    uuid references trips(id) on delete cascade,
  vessel_id  uuid,
  obs_id     bigint,
  kind       text not null,
  detail     text check (detail is null or char_length(detail) <= 300),
  data       jsonb not null default '{}'::jsonb,
  at         timestamptz not null default now()
);
create index on arrival_diagnostics (trip_id, at desc);
create index on arrival_diagnostics (company_id, at);
alter table arrival_diagnostics enable row level security;
create policy adg_select on arrival_diagnostics for select to authenticated using (is_company_ops(company_id));

-- Diagnostic line (ids and codes only, never tokens or people's details). p_throttle_s > 0 skips a repeat of the same
-- kind + detail for the trip within that many seconds. Also goes to the Postgres log.
create or replace function arrival_diag(p_company uuid, p_trip uuid, p_vessel uuid, p_obs bigint, p_kind text, p_detail text,
                                        p_data jsonb default '{}'::jsonb, p_throttle_s int default 0) returns void
  language plpgsql security definer set search_path = public as
$$ begin
  if p_throttle_s > 0 and exists (select 1 from arrival_diagnostics where trip_id is not distinct from p_trip and kind = p_kind
       and detail is not distinct from left(p_detail, 300) and at > now() - make_interval(secs => p_throttle_s)) then
    return;
  end if;
  insert into arrival_diagnostics (company_id, trip_id, vessel_id, obs_id, kind, detail, data)
    values (p_company, p_trip, p_vessel, p_obs, p_kind, left(p_detail, 300), coalesce(p_data, '{}'::jsonb));
  raise log 'arrival % trip=% vessel=% obs=% %', p_kind, p_trip, p_vessel, p_obs, left(p_detail, 200);
end $$;
revoke execute on function arrival_diag(uuid, uuid, uuid, bigint, text, text, jsonb, int) from anon, public, authenticated;

-- 5. The engine (pure, deterministic) -------------------------------------------------------------------------------
-- Where is a fix relative to a harbour zone, allowing for its uncertainty u (metres)?
--   inside   : the whole uncertainty circle is inside the boundary
--   boundary : the boundary is within u of the fix (cannot tell) — never counts towards arrival
--   approach : outside, within approach_m of the pin
--   outside  : further out
-- p_h is a harbour row as jsonb (lat, lng, geofence_type, radius_m, polygon, approach_m).
create or replace function arrival_zone(p_h jsonb, p_lat float8, p_lng float8, p_unc float8) returns jsonb
  language plpgsql immutable as
$$ declare d float8; e jsonb; signed float8; zone text; u float8 := greatest(coalesce(p_unc, 0), 0);
begin
  d := geo_distance_m((p_h->>'lat')::float8, (p_h->>'lng')::float8, p_lat, p_lng);
  if p_h->>'geofence_type' = 'polygon' and jsonb_typeof(p_h->'polygon') = 'array' then
    e := geo_polygon_eval(p_h->'polygon', p_lat, p_lng);
    signed := case when (e->>'inside')::boolean then -(e->>'edge_m')::float8 else (e->>'edge_m')::float8 end;
  else
    signed := d - (p_h->>'radius_m')::float8;   -- metres outside the circle (negative = inside)
  end if;
  zone := case when signed + u <= 0 then 'inside'
               when signed - u > 0 then case when d <= coalesce((p_h->>'approach_m')::float8, 2000) then 'approach' else 'outside' end
               else 'boundary' end;
  return jsonb_build_object('zone', zone, 'distance_m', round(d::numeric, 1), 'edge_m', round(signed::numeric, 1), 'uncertainty_m', u);
end $$;

-- Is a fix usable as evidence? Returns null when valid, otherwise a reason code.
-- p_obs {lat, lng, observed_at, accuracy_m}; p_prev = trip_arrival_state as jsonb; p_h = harbour; p_cfg = arrival_cfg().
create or replace function arrival_check_obs(p_obs jsonb, p_prev jsonb, p_h jsonb, p_cfg jsonb, p_now timestamptz) returns text
  language plpgsql immutable as
$$ declare la float8; lo float8; t timestamptz; acc float8; u float8; pt timestamptz; d float8; dt float8; kn float8; pu float8;
begin
  begin la := (p_obs->>'lat')::float8; lo := (p_obs->>'lng')::float8;
  exception when others then return 'invalid_coordinates'; end;
  if la is null or lo is null or la = 'NaN'::float8 or lo = 'NaN'::float8 or la not between -90 and 90 or lo not between -180 and 180
     or (la = 0 and lo = 0) then
    return 'invalid_coordinates';
  end if;
  begin t := (p_obs->>'observed_at')::timestamptz; exception when others then return 'missing_time'; end;
  if t is null then return 'missing_time'; end if;
  if t > p_now + make_interval(secs => (p_cfg->>'maxFutureSec')::float8) then return 'future_time'; end if;
  if p_now - t > make_interval(secs => (p_cfg->>'maxDelaySec')::float8) then return 'stale'; end if;
  pt := (p_prev->>'last_obs_at')::timestamptz;
  if pt is not null and t <= pt then return 'out_of_order'; end if;
  acc := (p_obs->>'accuracy_m')::float8;
  if acc is not null and (acc < 0 or acc = 'NaN'::float8) then return 'invalid_accuracy'; end if;
  u := coalesce(acc, (p_cfg->>'assumedAccuracyM')::float8);
  if u > (p_h->>'max_accuracy_m')::float8 then
    return case when acc is null then 'accuracy_unknown' else 'poor_accuracy' end;
  end if;
  -- Implausible jump from the last valid fix. After 2 rejections in a row the next fix re-anchors the track,
  -- so one bad fix cannot block a trip forever.
  if pt is not null and p_prev->>'last_lat' is not null and coalesce((p_prev->>'jump_rejects')::int, 0) < 2 then
    d := geo_distance_m((p_prev->>'last_lat')::float8, (p_prev->>'last_lng')::float8, la, lo);
    dt := greatest(extract(epoch from (t - pt)), 1);
    kn := d / dt * 1.943844;
    pu := coalesce((p_prev->>'last_accuracy_m')::float8, (p_cfg->>'assumedAccuracyM')::float8);
    if d > 3 * (u + pu) and kn > (p_cfg->>'maxSpeedKn')::float8 then return 'implausible_jump'; end if;
  end if;
  return null;
end $$;

-- One step of the state machine for a VALID fix. Returns the new state (same keys as trip_arrival_state) plus
-- event (none / enter / exit / reset_gap / confirmed), reason, zone_detail and, when confirmed, arrival{…}.
--   any → ARRIVAL_PENDING          first fix inside (streak starts at that fix's observed time)
--   ARRIVAL_PENDING → ARRIVED       ≥ min_obs fixes inside and ≥ dwell_sec between first and latest, speed not above passThroughKn
--   ARRIVAL_PENDING → APPROACHING / NOT_APPROACHING   a fix clearly outside (streak cancelled)
--   boundary fix                    keeps a streak but never counts; without a streak → APPROACHING_DESTINATION
--   gap > maxGapSec inside          streak restarts from the new fix (old fixes are no longer evidence)
--   ARRIVED                         final; nothing changes it here
create or replace function arrival_step(p_state jsonb, p_obs jsonb, p_h jsonb, p_cfg jsonb) returns jsonb
  language plpgsql immutable as
$$ declare s jsonb := coalesce(p_state, '{}'::jsonb); t timestamptz := (p_obs->>'observed_at')::timestamptz;
  la float8 := (p_obs->>'lat')::float8; lo float8 := (p_obs->>'lng')::float8; acc float8 := (p_obs->>'accuracy_m')::float8;
  spd float8 := (p_obs->>'speed_kn')::float8; z jsonb; zone text; ps timestamptz; li timestamptz; cnt int; first_obs bigint;
  entry timestamptz; lni timestamptz; ev text := 'none'; st text; reason text; arr jsonb; dwell float8;
  min_obs int := (p_h->>'min_obs')::int; dwell_need float8 := (p_h->>'dwell_sec')::float8;
  pass float8 := coalesce((p_cfg->>'passThroughKn')::float8, 0); hname text := coalesce(p_h->>'name', 'the destination harbour');
begin
  if s->>'state' = 'ARRIVED' then
    return s || jsonb_build_object('event', 'none', 'reason', 'Already arrived');
  end if;
  z := arrival_zone(p_h, la, lo, coalesce(acc, (p_cfg->>'assumedAccuracyM')::float8));
  zone := z->>'zone';
  ps := (s->>'pending_since')::timestamptz; li := (s->>'last_inside_at')::timestamptz;
  cnt := coalesce((s->>'pending_count')::int, 0); first_obs := (s->>'pending_first_obs')::bigint;
  entry := (s->>'entry_after')::timestamptz; lni := (s->>'last_not_inside_at')::timestamptz;

  if ps is not null and li is not null and extract(epoch from (t - li)) > (p_cfg->>'maxGapSec')::float8 then
    ps := null; cnt := 0; first_obs := null; entry := null; ev := 'reset_gap';
  end if;

  if zone = 'inside' then
    if ps is null then
      ps := t; cnt := 1; first_obs := (p_obs->>'id')::bigint; entry := lni;
      if ev = 'none' then ev := 'enter'; end if;
    else
      cnt := cnt + 1;
    end if;
    li := t; st := 'ARRIVAL_PENDING';
    dwell := extract(epoch from (t - ps));
    if cnt >= min_obs and dwell >= dwell_need then
      if spd is not null and pass > 0 and spd > pass then
        reason := format('Inside %s but still moving at %s kn — waiting for the boat to slow down', hname, round(spd::numeric, 1));
      else
        st := 'ARRIVED'; ev := 'confirmed';
        arr := jsonb_build_object('arrived_at', ps, 'arrived_after', entry,
          'uncertainty_s', case when entry is not null then round(extract(epoch from (ps - entry)))::int end,
          'confirmed_obs_at', t, 'first_obs_id', first_obs, 'confirm_obs_id', (p_obs->>'id')::bigint,
          'fixes', cnt, 'dwell_s', round(dwell::numeric));
        reason := format('Arrival confirmed: %s fixes over %s s inside %s', cnt, round(dwell::numeric), hname);
      end if;
    else
      reason := format('Inside %s: %s of %s fixes, %s of %s s', hname, cnt, min_obs, round(dwell::numeric), round(dwell_need::numeric));
    end if;
  elsif zone = 'boundary' then
    lni := t;
    if ps is not null then
      st := 'ARRIVAL_PENDING'; reason := format('At the edge of %s; GPS too uncertain to count this fix', hname);
    else
      st := 'APPROACHING_DESTINATION'; reason := format('At the edge of %s', hname);
    end if;
  else
    if ps is not null then ev := 'exit'; end if;
    ps := null; cnt := 0; first_obs := null; entry := null; lni := t;
    st := case when zone = 'approach' then 'APPROACHING_DESTINATION' else 'NOT_APPROACHING' end;
    reason := format('%s m from %s', round((z->>'distance_m')::numeric), hname);
  end if;

  return s || jsonb_build_object('state', st, 'reason', reason, 'event', ev, 'zone_detail', z, 'arrival', arr,
    'pending_since', ps, 'pending_count', cnt, 'pending_first_obs', first_obs, 'entry_after', entry,
    'last_inside_at', li, 'last_not_inside_at', lni, 'last_obs_id', (p_obs->>'id')::bigint, 'last_obs_at', t,
    'last_lat', la, 'last_lng', lo, 'last_accuracy_m', acc, 'last_zone', zone, 'last_distance_m', (z->>'distance_m')::float8,
    'jump_rejects', 0);
end $$;

-- 6. Ingest: validate → lock → step → persist ------------------------------------------------------------------------
-- Internal (not callable by users). p_trip pins the trip (crew sessions); otherwise the vessel's trip under way.
-- p_now only exists for tests (defaults to now()).
create or replace function arrival_ingest(
  p_vessel uuid, p_lat float8, p_lng float8, p_observed_at timestamptz, p_accuracy_m float8, p_speed_kn float8, p_heading float8,
  p_source text, p_device_ref text, p_client_ref text, p_actor uuid, p_time_basis text default 'device',
  p_received_at timestamptz default null, p_trip uuid default null, p_now timestamptz default null) returns jsonb
  language plpgsql security definer set search_path = public as
$$ declare v vessels; t trips; h harbours; cfg jsonb; st trip_arrival_state; obs_id bigint; obs jsonb; why text; step jsonb;
  now_ts timestamptz := coalesce(p_now, now()); recv timestamptz := coalesce(p_received_at, coalesce(p_now, now()));
  ev_id uuid; method text; arr jsonb; crew_only boolean; tz text; first_pos record; ev text;
begin
  select * into v from vessels where id = p_vessel;
  if not found then return jsonb_build_object('status', 'rejected', 'reason', 'unknown_vessel'); end if;
  if p_trip is not null then
    select * into t from trips where id = p_trip and vessel_id = p_vessel;
  else
    select * into t from trips where vessel_id = p_vessel and status in ('Departed', 'In transit') order by depart_at desc limit 1;
  end if;

  insert into vessel_positions (company_id, vessel_id, trip_id, source, device_ref, client_ref, reported_by, observed_at, received_at,
                                time_basis, lat, lng, accuracy_m, speed_kn, heading, validity)
    values (v.company_id, v.id, t.id, p_source, coalesce(p_device_ref, ''), p_client_ref, p_actor, p_observed_at, recv,
            coalesce(p_time_basis, 'device'), p_lat, p_lng, p_accuracy_m, p_speed_kn, p_heading, 'pending')
    on conflict do nothing returning id into obs_id;
  if obs_id is null then
    -- Same fix again (FollowMe cache, a phone replaying its queue): never new evidence.
    if p_source <> 'followme' and t.id is not null then
      perform arrival_diag(v.company_id, t.id, v.id, null, 'duplicate', 'Duplicate fix ignored (' || p_source || ')', '{}'::jsonb, 300);
    end if;
    return jsonb_build_object('status', 'duplicate');
  end if;
  if t.id is null then
    update vessel_positions set validity = 'no_active_trip' where id = obs_id;
    return jsonb_build_object('status', 'ignored', 'reason', 'no_active_trip', 'obs', obs_id);
  end if;

  cfg := arrival_cfg(v.company_id);
  if not coalesce((cfg->>'enabled')::boolean, true) then
    update vessel_positions set validity = 'detection_off' where id = obs_id;
    return jsonb_build_object('status', 'ignored', 'reason', 'detection_off', 'obs', obs_id);
  end if;

  -- One evaluation per trip at a time: every fix for the trip waits for this row lock.
  insert into trip_arrival_state (trip_id, company_id, vessel_id, destination_harbour_id)
    values (t.id, t.company_id, t.vessel_id, t.destination_harbour_id) on conflict (trip_id) do nothing;
  select * into st from trip_arrival_state where trip_id = t.id for update;
  select * into t from trips where id = t.id;   -- re-read under the lock
  update trip_arrival_state set last_any_received_at = greatest(coalesce(last_any_received_at, recv), recv),
         vessel_id = t.vessel_id, destination_harbour_id = t.destination_harbour_id where trip_id = t.id;

  if st.state = 'ARRIVED' or trip_closed(t.status) then
    update vessel_positions set validity = case when t.status = 'Cancelled' then 'trip_cancelled' else 'after_arrival' end where id = obs_id;
    return jsonb_build_object('status', 'ignored', 'reason', case when t.status = 'Cancelled' then 'trip_cancelled' else 'already_arrived' end, 'obs', obs_id);
  end if;
  if t.status not in ('Departed', 'In transit') then
    update vessel_positions set validity = 'trip_not_under_way' where id = obs_id;
    return jsonb_build_object('status', 'ignored', 'reason', 'trip_not_under_way', 'obs', obs_id);
  end if;
  if p_source = 'crew_device' and not coalesce((cfg->>'allowCrewDevices')::boolean, true) then
    update vessel_positions set validity = 'crew_devices_off' where id = obs_id;
    return jsonb_build_object('status', 'ignored', 'reason', 'crew_devices_off', 'obs', obs_id);
  end if;
  if t.destination_harbour_id is not null then select * into h from harbours where id = t.destination_harbour_id; end if;
  if h.id is null or not h.active then
    update vessel_positions set validity = 'no_destination_harbour' where id = obs_id;
    update trip_arrival_state set reason = 'Destination harbour not set up — add it to the route (Operations → Harbours)', updated_at = now_ts
      where trip_id = t.id;
    perform arrival_diag(t.company_id, t.id, v.id, obs_id, 'not_configured', 'No active destination harbour for this trip', '{}'::jsonb, 3600);
    return jsonb_build_object('status', 'ignored', 'reason', 'no_destination_harbour', 'obs', obs_id);
  end if;

  obs := jsonb_build_object('id', obs_id, 'lat', p_lat, 'lng', p_lng, 'observed_at', p_observed_at, 'accuracy_m', p_accuracy_m,
                            'speed_kn', p_speed_kn, 'source', p_source);
  if p_observed_at is not null and p_observed_at < coalesce(t.actual_depart, t.depart_at) - interval '30 minutes' then
    why := 'before_departure';
  elsif p_time_basis = 'received' and st.last_lat = p_lat and st.last_lng = p_lng then
    why := 'unchanged_position';   -- feed without its own timestamps repeating the same point: not new evidence
  else
    why := arrival_check_obs(obs, to_jsonb(st), to_jsonb(h), cfg, now_ts);
  end if;
  if why is not null then
    update vessel_positions set validity = why where id = obs_id;
    update trip_arrival_state set rejected = rejected + 1,
           jump_rejects = case when why = 'implausible_jump' then jump_rejects + 1 else jump_rejects end, updated_at = now_ts
      where trip_id = t.id;
    perform arrival_diag(t.company_id, t.id, v.id, obs_id, 'invalid_obs', 'Fix not used: ' || why,
      jsonb_build_object('source', p_source, 'observed_at', p_observed_at, 'accuracy_m', p_accuracy_m), 120);
    return jsonb_build_object('status', 'rejected', 'reason', why, 'state', st.state, 'obs', obs_id);
  end if;

  step := arrival_step(to_jsonb(st), obs, to_jsonb(h), cfg);
  ev := step->>'event';
  update vessel_positions set validity = 'valid', zone = step->>'last_zone', distance_m = (step->>'last_distance_m')::real where id = obs_id;
  update trip_arrival_state set
      state = step->>'state', reason = step->>'reason',
      pending_since = (step->>'pending_since')::timestamptz, pending_count = (step->>'pending_count')::int,
      pending_first_obs = (step->>'pending_first_obs')::bigint, entry_after = (step->>'entry_after')::timestamptz,
      last_inside_at = (step->>'last_inside_at')::timestamptz, last_not_inside_at = (step->>'last_not_inside_at')::timestamptz,
      last_obs_id = obs_id, last_obs_at = p_observed_at, last_received_at = recv,
      last_lat = p_lat, last_lng = p_lng, last_accuracy_m = p_accuracy_m,
      last_zone = step->>'last_zone', last_distance_m = (step->>'last_distance_m')::real, last_source = p_source,
      jump_rejects = 0, accepted = accepted + 1, updated_at = now_ts
    where trip_id = t.id;
  if ev in ('enter', 'exit', 'reset_gap') then
    perform arrival_diag(t.company_id, t.id, v.id, obs_id,
      case ev when 'enter' then 'geofence_enter' when 'exit' then 'geofence_exit' else 'tracking_gap' end,
      case ev when 'enter' then 'Entered ' || h.name when 'exit' then 'Left ' || h.name || ' before arrival was confirmed'
              else 'Gap in fixes inside ' || h.name || '; confirmation restarted' end,
      jsonb_build_object('distance_m', step->'last_distance_m', 'zone', step->'last_zone'));
  end if;

  if step->>'state' <> 'ARRIVED' then
    if (step->>'pending_count')::int >= h.min_obs then
      perform arrival_diag(t.company_id, t.id, v.id, obs_id, 'confirm_attempt', step->>'reason', '{}'::jsonb, 60);
    end if;
    return jsonb_build_object('status', 'ok', 'state', step->>'state', 'zone', step->>'last_zone',
                              'distance_m', step->'last_distance_m', 'reason', step->>'reason', 'obs', obs_id);
  end if;

  -- Confirmed. Persist inside a sub-transaction so a failure is logged and the trip stays pending (next fix retries).
  arr := step->'arrival';
  select bool_and(source = 'crew_device') into crew_only from vessel_positions
    where trip_id = t.id and validity = 'valid' and observed_at between (arr->>'arrived_at')::timestamptz and (arr->>'confirmed_obs_at')::timestamptz;
  method := case when coalesce(crew_only, p_source = 'crew_device') then 'crew_device_geofence' else 'gps_geofence' end;
  select lat, lng, accuracy_m, time_basis, received_at into first_pos from vessel_positions where id = (arr->>'first_obs_id')::bigint;
  tz := company_tz(t.company_id);
  begin
    insert into trip_arrival_events (company_id, trip_id, vessel_id, origin_harbour_id, destination_harbour_id, method,
        arrived_at, arrived_after, uncertainty_s, time_basis, confirmed_obs_at, obs_received_at, confirmed_at,
        lat, lng, accuracy_m, evidence, algorithm_version, reason)
      values (t.company_id, t.id, t.vessel_id, t.origin_harbour_id, t.destination_harbour_id, method,
        (arr->>'arrived_at')::timestamptz, (arr->>'arrived_after')::timestamptz, (arr->>'uncertainty_s')::int,
        coalesce(first_pos.time_basis, p_time_basis), (arr->>'confirmed_obs_at')::timestamptz, recv, now(),
        first_pos.lat, first_pos.lng, first_pos.accuracy_m,
        arr || jsonb_build_object('harbour', h.name, 'radius_m', h.radius_m, 'geofence', h.geofence_type, 'min_obs', h.min_obs,
                                  'dwell_sec', h.dwell_sec, 'max_accuracy_m', h.max_accuracy_m, 'sources', (
          select jsonb_agg(distinct source) from vessel_positions where trip_id = t.id and validity = 'valid'
            and observed_at between (arr->>'arrived_at')::timestamptz and (arr->>'confirmed_obs_at')::timestamptz)),
        arrival_algorithm_version(), step->>'reason')
      on conflict do nothing returning id into ev_id;
    if ev_id is null then
      update trip_arrival_state set state = 'ARRIVED', reason = 'Arrival already recorded' where trip_id = t.id;
      perform arrival_diag(t.company_id, t.id, v.id, obs_id, 'duplicate_prevented', 'Arrival already recorded; second confirmation ignored');
      return jsonb_build_object('status', 'ignored', 'reason', 'already_arrived', 'obs', obs_id);
    end if;
    update trips set status = 'Arrived', actual_arrive = (arr->>'arrived_at')::timestamptz,
                     meta = meta || jsonb_build_object('arrival_source', method, 'arrival_event', ev_id)
      where id = t.id and not trip_closed(status);
    insert into trip_events (company_id, trip_id, kind, detail, meta)
      values (t.company_id, t.id, 'auto', left('Arrived at ' || h.name || ' ' || local_time(t.company_id, (arr->>'arrived_at')::timestamptz)
              || ' (GPS, ' || (arr->>'fixes') || ' fixes over ' || (arr->>'dwell_s') || ' s)', 300), jsonb_build_object('arrival_event', ev_id));
    if coalesce((cfg->>'completeBookings')::boolean, false) then
      update bookings set status = 'Completed', updated_at = now() where trip_id = t.id and status in ('Confirmed', 'Checked in', 'Boarded');
    end if;
    perform notify_many(t.company_id, ops_user_ids(t.company_id), 'trip', 'arrived', 'trip', t.id::text,
      coalesce(v.name, 'Vessel') || ' arrived at ' || h.name || ' at '
        || to_char((arr->>'arrived_at')::timestamptz at time zone tz, 'HH24:MI "on" FMDD FMMonth YYYY') || '.',
      coalesce(t.code, 'Trip') || ' · confirmed by GPS (' || (arr->>'fixes') || ' fixes).');
    perform arrival_diag(t.company_id, t.id, v.id, obs_id, 'confirmed', step->>'reason', jsonb_build_object('event', ev_id));
  exception when others then
    perform arrival_diag(t.company_id, t.id, v.id, obs_id, 'persist_error', 'Arrival could not be saved: ' || left(sqlerrm, 200));
    update trip_arrival_state set state = 'ARRIVAL_PENDING', reason = 'Arrival detected but could not be saved; retrying with the next fix'
      where trip_id = t.id;
    return jsonb_build_object('status', 'error', 'reason', 'persist_failed', 'obs', obs_id);
  end;
  return jsonb_build_object('status', 'arrived', 'state', 'ARRIVED', 'event', ev_id, 'arrived_at', arr->'arrived_at', 'obs', obs_id);
end $$;
revoke execute on function arrival_ingest(uuid, float8, float8, timestamptz, float8, float8, float8, text, text, text, uuid, text, timestamptz, uuid, timestamptz)
  from anon, public, authenticated;

-- Crew phones: the captain or crew of a trip under way share fixes for THAT trip (an explicit tracking session).
-- These are estimates of the vessel position (stored as crew_device). p_client_ref = the phone's id for the fix,
-- so a replayed offline queue is ignored. Speed in metres/second as browsers report it.
create or replace function ingest_vessel_position(p_trip uuid, p_lat float8, p_lng float8, p_observed_at timestamptz,
    p_accuracy_m float8 default null, p_speed_mps float8 default null, p_heading float8 default null,
    p_device text default null, p_client_ref text default null) returns jsonb
  language plpgsql security definer set search_path = public as
$$ declare t trips;
begin
  if auth.uid() is null then raise exception 'Sign in first.'; end if;
  select * into t from trips where id = p_trip;
  if not found or not is_company_member(t.company_id) then raise exception 'Trip not found.'; end if;
  if not (t.captain_id = auth.uid() or exists (select 1 from trip_crew where trip_id = t.id and user_id = auth.uid())) then
    raise exception 'Only the captain or crew of this trip can share its position.';
  end if;
  if t.vessel_id is null then raise exception 'This trip has no vessel.'; end if;
  return arrival_ingest(t.vessel_id, p_lat, p_lng, p_observed_at, p_accuracy_m,
    case when p_speed_mps is not null and p_speed_mps >= 0 then p_speed_mps * 1.943844 end, p_heading,
    'crew_device', left(md5(auth.uid()::text || ':' || coalesce(p_device, '')), 16), left(nullif(btrim(p_client_ref), ''), 64),
    auth.uid(), 'device', null, t.id);
end $$;
revoke execute on function ingest_vessel_position(uuid, float8, float8, timestamptz, float8, float8, float8, text, text) from anon, public;
grant execute on function ingest_vessel_position(uuid, float8, float8, timestamptz, float8, float8, float8, text, text) to authenticated;

-- 7. FollowMe feed (server side) -------------------------------------------------------------------------------------
-- followme_fetch (0049) split in two: the core without the membership check so the every-minute job can use the same
-- per-company minute limit and cache. Behaviour of followme_fetch for the page is unchanged.
create or replace function followme_fetch_core(p_vessel uuid) returns jsonb
  language plpgsql security definer set search_path = public, extensions as
$$ declare
  v vessels; u text; c followme_cache; last_call timestamptz; code int; txt text; err text; res jsonb;
  attr constant text := 'FollowMe Tracking Service';
begin
  if p_vessel is null then return jsonb_build_object('error', 'Choose a vessel.'); end if;
  select * into v from vessels where id = p_vessel;
  if not found then return jsonb_build_object('error', 'Vessel not found.'); end if;

  select url into u from followme_links where vessel_id = p_vessel;
  if u is null then
    return jsonb_build_object('error', 'No FollowMe link on this vessel. Add it under Fleet / Maintenance → Edit.');
  end if;

  perform pg_advisory_xact_lock(hashtext('followme:' || v.company_id::text));

  select * into c from followme_cache where company_id = v.company_id and url = u;
  if found and c.body is not null and c.fetched_at > now() - interval '60 seconds' then
    return jsonb_build_object('status', c.status, 'body', c.body, 'cached', true, 'stale', false, 'at', c.fetched_at,
                              'hint', followme_hint(u), 'attribution', attr);
  end if;

  select last_call_at into last_call from followme_calls where company_id = v.company_id;
  if last_call is not null and last_call > now() - interval '60 seconds' then
    res := jsonb_build_object('next_in', ceil(extract(epoch from (last_call + interval '60 seconds' - now())))::int,
                              'hint', followme_hint(u), 'attribution', attr);
    if c.body is not null then
      return res || jsonb_build_object('status', c.status, 'body', c.body, 'cached', true, 'stale', true, 'at', c.fetched_at,
                                       'warning', 'FollowMe allows one update a minute; showing the last position.');
    end if;
    return res || jsonb_build_object('error', 'FollowMe allows one update a minute. Try again in a moment.');
  end if;

  insert into followme_calls (company_id, last_call_at) values (v.company_id, now())
  on conflict (company_id) do update set last_call_at = excluded.last_call_at;

  begin
    begin
      perform http_set_curlopt('CURLOPT_TIMEOUT', '6');
      perform http_set_curlopt('CURLOPT_CONNECTTIMEOUT', '4');
    exception when others then null;
    end;
    select status, content into code, txt from http_get(u);
    if code is null or code < 200 or code >= 300 then
      err := 'FollowMe answered with status ' || coalesce(code::text, 'none') || '.';
    elsif txt is null then
      err := 'FollowMe sent an empty answer.';
    elsif octet_length(txt) > 524288 then
      err := 'FollowMe sent too much data (over 512 KB).';
    end if;
  exception when others then
    err := 'Could not reach FollowMe (' || left(sqlerrm, 120) || ').';
  end;

  if err is null then
    insert into followme_cache (company_id, url, status, body, fetched_at, tried_at, last_error)
    values (v.company_id, u, code, txt, now(), now(), null)
    on conflict (company_id, url) do update set status = excluded.status, body = excluded.body, fetched_at = excluded.fetched_at,
                                                tried_at = excluded.tried_at, last_error = null;
    return jsonb_build_object('status', code, 'body', txt, 'cached', false, 'stale', false, 'at', now(),
                              'hint', followme_hint(u), 'attribution', attr);
  end if;

  insert into followme_cache (company_id, url, tried_at, last_error) values (v.company_id, u, now(), err)
  on conflict (company_id, url) do update set tried_at = excluded.tried_at, last_error = excluded.last_error;
  if c.body is not null then
    return jsonb_build_object('status', c.status, 'body', c.body, 'cached', true, 'stale', true, 'at', c.fetched_at,
                              'warning', err || ' Showing the last position.', 'hint', followme_hint(u), 'attribution', attr);
  end if;
  return jsonb_build_object('error', err, 'hint', followme_hint(u), 'attribution', attr);
end $$;
revoke execute on function followme_fetch_core(uuid) from anon, public, authenticated;

create or replace function followme_fetch(p_vessel uuid) returns jsonb
  language plpgsql security definer set search_path = public, extensions as
$$ declare cid uuid;
begin
  if p_vessel is null then return jsonb_build_object('error', 'Choose a vessel.'); end if;
  select company_id into cid from vessels where id = p_vessel;
  if cid is null then return jsonb_build_object('error', 'Vessel not found.'); end if;
  if not is_company_member(cid) then raise exception 'Not a member of this company.'; end if;
  return followme_fetch_core(p_vessel);
end $$;
revoke all on function followme_fetch(uuid) from anon, public;
grant execute on function followme_fetch(uuid) to authenticated;

create or replace function try_float(p text) returns float8
  language plpgsql immutable as
$$ begin return nullif(btrim(p), '')::float8; exception when others then return null; end $$;

-- Same field names as operations.js pickLatLng(). Speed is only taken when the feed says it is knots.
create or replace function followme_pick(o jsonb) returns jsonb
  language plpgsql immutable as
$$ declare la float8; lo float8;
begin
  if o is null or jsonb_typeof(o) <> 'object' then return null; end if;
  la := try_float(coalesce(o->>'lat', o->>'la', o->>'latitude', o->>'Latitude', o->>'LAT'));
  lo := try_float(coalesce(o->>'lng', o->>'lon', o->>'lo', o->>'longitude', o->>'Longitude', o->>'LONG'));
  if la is null or lo is null or abs(la) > 90 or abs(lo) > 180 then return null; end if;
  return jsonb_build_object('lat', la, 'lng', lo, 'id', o->>'id',
    'name', coalesce(o->>'name', o->>'Name', o->>'vessel', o->>'Vessel', ''),
    'speed_kn', try_float(coalesce(o->>'Speed(kn)', o->>'speed_kn')),
    'heading', try_float(coalesce(o->>'heading', o->>'course', o->>'Course', o->>'Heading')),
    'updated', coalesce(o->>'updated', o->>'Updated', o->>'time', o->>'Time', o->>'date', o->>'Date', o->>'timestamp'));
end $$;

-- The vessel's position from a FollowMe answer (same shapes operations.js accepts). When the feed lists several
-- boats, only an exact name match is used; otherwise {error: 'ambiguous'} — a fix is never pinned on the wrong vessel.
create or replace function followme_position(p_body text, p_name text) returns jsonb
  language plpgsql immutable as
$$ declare j jsonb; items jsonb := '[]'::jsonb; one jsonb; e jsonb; k text; found jsonb := '[]'::jsonb; m text; nmatch int;
begin
  if p_body is null or btrim(p_body) = '' then return '{"error":"empty"}'::jsonb; end if;
  begin
    j := p_body::jsonb;
  exception when others then
    m := substring(p_body from '(\{.*\}|\[.*\])');
    begin j := m::jsonb; exception when others then return '{"error":"not_json"}'::jsonb; end;
  end;
  if j is null then return '{"error":"not_json"}'::jsonb; end if;
  if jsonb_typeof(j) = 'array' then
    items := j;
  elsif jsonb_typeof(j->'data') = 'array' then
    items := j->'data';
  elsif jsonb_typeof(j->'data') = 'object' then
    for k, e in select key, value from jsonb_each(j->'data') loop
      if jsonb_typeof(e) = 'object' then items := items || jsonb_build_array(jsonb_build_object('id', k) || e); end if;
    end loop;
  elsif jsonb_typeof(j) = 'object' then
    one := followme_pick(j);
    if one is not null then return one; end if;
    for k, e in select key, value from jsonb_each(j) loop
      continue when k in ('data', 'status', 'message');
      if jsonb_typeof(e) = 'object' then items := items || jsonb_build_array(jsonb_build_object('id', k) || e); end if;
    end loop;
  end if;
  for e in select value from jsonb_array_elements(items) loop
    one := followme_pick(e);
    if one is not null then found := found || jsonb_build_array(one); end if;
  end loop;
  if jsonb_array_length(found) = 1 then return found->0; end if;
  if jsonb_array_length(found) = 0 then return '{"error":"no_position"}'::jsonb; end if;
  select count(*) into nmatch from jsonb_array_elements(found) x where lower(btrim(x->>'name')) = lower(btrim(coalesce(p_name, '')));
  if nmatch = 1 then
    select x into one from jsonb_array_elements(found) x where lower(btrim(x->>'name')) = lower(btrim(coalesce(p_name, '')));
    return one;
  end if;
  return '{"error":"ambiguous"}'::jsonb;
end $$;

-- Observed time of a feed fix. Epoch seconds/ms or ISO with offset → device; ISO without offset → company local time
-- (device_local); missing / unreadable / more than 5 min ahead of the fetch → the fetch time (received).
create or replace function followme_time(p text, p_tz text, p_fetched timestamptz) returns jsonb
  language plpgsql stable as
$$ declare at timestamptz; basis text; n numeric;
begin
  if p is null or btrim(p) = '' then return jsonb_build_object('at', p_fetched, 'basis', 'received'); end if;
  begin
    if btrim(p) ~ '^\d{9,13}(\.\d+)?$' then
      n := btrim(p)::numeric; if n > 100000000000 then n := n / 1000; end if;
      at := to_timestamp(n); basis := 'device';
    elsif btrim(p) ~* '(z|[+-]\d{2}:?\d{2})$' then
      at := btrim(p)::timestamptz; basis := 'device';
    else
      at := btrim(p)::timestamp at time zone p_tz; basis := 'device_local';
    end if;
  exception when others then
    return jsonb_build_object('at', p_fetched, 'basis', 'received');
  end;
  if at > p_fetched + interval '5 minutes' then return jsonb_build_object('at', p_fetched, 'basis', 'received'); end if;
  return jsonb_build_object('at', at, 'basis', basis);
end $$;

-- Poll FollowMe for vessels under way that GPS can judge. Least recently tried first; followme_fetch_core keeps it to
-- one outside call per company per minute (other vessels get the cache, which is then a duplicate and ignored).
create or replace function arrival_poll_followme(p_company uuid) returns integer
  language plpgsql security definer set search_path = public as
$$ declare r record; res jsonb; pos jsonb; tm jsonb; n int := 0; tz text := company_tz(p_company);
begin
  for r in select t.id trip_id, t.vessel_id, v.name vname from trips t
             join vessels v on v.id = t.vessel_id
             join followme_links l on l.vessel_id = t.vessel_id
             left join followme_cache c on c.company_id = t.company_id and c.url = l.url
           where t.company_id = p_company and t.status in ('Departed', 'In transit') and t.destination_harbour_id is not null
           order by c.tried_at nulls first limit 10 loop
    begin
      res := followme_fetch_core(r.vessel_id);
      if res->>'body' is null then
        perform arrival_diag(p_company, r.trip_id, r.vessel_id, null, 'feed_error', coalesce(res->>'error', 'No FollowMe answer'), '{}'::jsonb, 600);
        continue;
      end if;
      pos := followme_position(res->>'body', r.vname);
      if pos ? 'error' then
        perform arrival_diag(p_company, r.trip_id, r.vessel_id, null, 'feed_unreadable', 'FollowMe answer has no usable position: ' || (pos->>'error'), '{}'::jsonb, 600);
        continue;
      end if;
      tm := followme_time(pos->>'updated', tz, (res->>'at')::timestamptz);
      perform arrival_ingest(r.vessel_id, (pos->>'lat')::float8, (pos->>'lng')::float8, (tm->>'at')::timestamptz, null,
                             (pos->>'speed_kn')::float8, (pos->>'heading')::float8, 'followme', '', null, null,
                             tm->>'basis', (res->>'at')::timestamptz, r.trip_id);
      n := n + 1;
    exception when others then
      perform arrival_diag(p_company, r.trip_id, r.vessel_id, null, 'feed_error', 'FollowMe poll failed: ' || left(sqlerrm, 150), '{}'::jsonb, 600);
    end;
  end loop;
  return n;
end $$;
revoke execute on function arrival_poll_followme(uuid) from anon, public, authenticated;

-- 8. Sweep (every minute from ops_auto): state rows, FollowMe poll, tracking gaps, retention -------------------------
create or replace function arrival_sweep(p_company uuid, p_now timestamptz default null) returns integer
  language plpgsql security definer set search_path = public as
$$ declare cfg jsonb := arrival_cfg(p_company); s record; n int := 0; now_ts timestamptz := coalesce(p_now, now()); gap int;
begin
  if not coalesce((cfg->>'enabled')::boolean, true) then return 0; end if;
  gap := (cfg->>'trackingGapSec')::int;
  insert into trip_arrival_state (trip_id, company_id, vessel_id, destination_harbour_id)
    select id, company_id, vessel_id, destination_harbour_id from trips
     where company_id = p_company and status in ('Departed', 'In transit') and destination_harbour_id is not null
    on conflict (trip_id) do nothing;
  if p_now is null then
    begin n := n + arrival_poll_followme(p_company); exception when others then null; end;
  end if;
  for s in select st.trip_id, st.vessel_id, st.last_obs_at from trip_arrival_state st join trips t on t.id = st.trip_id
            where st.company_id = p_company and t.status in ('Departed', 'In transit')
              and st.state not in ('ARRIVED', 'TRACKING_UNAVAILABLE')
              and coalesce(st.last_obs_at, t.actual_depart, t.depart_at) < now_ts - make_interval(secs => gap)
            for update of st skip locked loop
    update trip_arrival_state set state = 'TRACKING_UNAVAILABLE', updated_at = now_ts,
           reason = case when s.last_obs_at is null then 'No usable GPS fix since departure'
                         else 'No usable GPS fix for ' || round(extract(epoch from (now_ts - s.last_obs_at)) / 60) || ' min' end
      where trip_id = s.trip_id;
    perform arrival_diag(p_company, s.trip_id, s.vessel_id, null, 'tracking_gap', 'Tracking unavailable: no usable fix for over ' || gap || ' s');
    n := n + 1;
  end loop;
  delete from vessel_positions where id in (select id from vessel_positions where company_id = p_company
    and received_at < now_ts - make_interval(days => (cfg->>'retentionDays')::int) limit 5000);
  delete from arrival_diagnostics where id in (select id from arrival_diagnostics where company_id = p_company
    and at < now_ts - make_interval(days => (cfg->>'retentionDays')::int) limit 5000);
  return n;
end $$;
revoke execute on function arrival_sweep(uuid, timestamptz) from anon, public, authenticated;

-- Can GPS judge this trip's arrival? (detection on, active destination harbour, and a tracking source)
create or replace function arrival_gps_managed(p_trip uuid) returns boolean
  language sql stable security definer set search_path = public as
$$ select coalesce((arrival_cfg(t.company_id)->>'enabled')::boolean, true)
          and exists (select 1 from harbours h where h.id = t.destination_harbour_id and h.active)
          and (exists (select 1 from followme_links l where l.vessel_id = t.vessel_id)
               or exists (select 1 from vessel_positions p where p.trip_id = t.id and p.source = 'crew_device'))
     from trips t where t.id = p_trip $$;
revoke execute on function arrival_gps_managed(uuid) from anon, public, authenticated;

-- 9. ops_auto (latest = 0045) with GPS-aware arrival. Everything before the arrival block is unchanged.
create or replace function ops_auto(p_company uuid) returns integer
  language plpgsql security definer set search_path = public as
$$ declare r jsonb; ci jsonb; board int; n int := 0; t record; why text; who uuid[]; acfg jsonb; hname text;
begin
  r := company_setting(p_company, '3_departure_and_arrival_rules');
  ci := company_setting(p_company, '7_check_in_rules');
  board := coalesce(nullif(r->>'boarding', '')::int, 15);
  who := ops_user_ids(p_company);

  n := n + trips_ahead(p_company);
  n := n + auto_assign_crew(p_company);

  if coalesce((r->>'autoBoarding')::boolean, true) then
    for t in select id from trips where company_id = p_company and status = 'Scheduled' and depart_at > now() and depart_at <= now() + make_interval(mins => board) loop
      begin
        update trips set status = 'Boarding' where id = t.id;
        insert into trip_events (company_id, trip_id, kind, detail) values (p_company, t.id, 'auto', 'Boarding opened automatically');
        n := n + 1;
      exception when others then null;
      end;
    end loop;
  end if;

  if coalesce((r->>'autoDepart')::boolean, true) then
    for t in select tr.id, tr.code, tr.status, tr.status_reason, tr.depart_at, tr.vessel_id, tr.captain_id, tr.cleared_at, v.name vname, v.status vstatus
             from trips tr left join vessels v on v.id = tr.vessel_id
             where tr.company_id = p_company and tr.depart_at <= now()
               and tr.status in ('Scheduled', 'Boarding') and tr.depart_at > now() - interval '1 day' loop
      why := case
        when t.vessel_id is null then 'no vessel'
        when t.vstatus = 'Out of service' then 'vessel out of service'
        when exists (select 1 from defects d where d.vessel_id = t.vessel_id and d.stops_operation and d.status in ('Open', 'Temporary fix')) then 'stopping defect'
        when coalesce((r->>'needCaptain')::boolean, true) and t.captain_id is null then 'no captain'
        when coalesce((r->>'needClearance')::boolean, false) and t.cleared_at is null then 'not cleared'
        end;
      begin
        if why is null then
          update trips set status = 'Departed', status_reason = null, actual_depart = t.depart_at where id = t.id;
          insert into trip_events (company_id, trip_id, kind, detail)
            values (p_company, t.id, 'auto', 'Departed automatically at departure time' || case when t.cleared_at is null then ' — not cleared for dispatch' else '' end);
          update booking_passengers set status = 'Boarded', boarded_at = coalesce(boarded_at, now()) where trip_id = t.id and status = 'Checked in';
          if coalesce((ci->>'autoNoShow')::boolean, false) then
            update booking_passengers set status = 'No-show' where trip_id = t.id and status = 'Booked';
          end if;
          n := n + 1;
        else
          insert into trip_events (company_id, trip_id, kind, detail)
            select p_company, t.id, 'auto', 'Held at departure — ' || why || ' (not marked Delayed; mark Delay by hand if needed)'
            where not exists (
              select 1 from trip_events e where e.trip_id = t.id and e.kind = 'auto'
                and e.detail like 'Held at departure — ' || why || '%'
                and e.created_at > now() - interval '1 hour');
        end if;
      exception when others then null;
      end;
    end loop;
  end if;

  -- GPS arrival detection (0058): poll, tracking gaps, retention.
  begin n := n + arrival_sweep(p_company); exception when others then null; end;
  acfg := arrival_cfg(p_company);

  if coalesce((r->>'auto')::boolean, true) then
    for t in select x.id, x.code, x.arrive_at, x.destination_harbour_id from trips x where x.company_id = p_company and x.status in ('Departed', 'In transit')
               and trip_end(x) + make_interval(mins => coalesce(nullif(r->>'arriveAfter', '')::int, 0)) <= now() loop
      begin
        if arrival_gps_managed(t.id) then
          -- GPS decides. Never take the scheduled time as the actual arrival unless the company opted in.
          if (select trip_end(x) from trips x where x.id = t.id)
               + make_interval(mins => coalesce(nullif(r->>'arriveAfter', '')::int, 0) + (acfg->>'fallbackAfterMin')::int) <= now() then
            if coalesce((acfg->>'clockFallback')::boolean, false) then
              update trips set status = 'Arrived', actual_arrive = coalesce(actual_arrive, arrive_at, now()),
                               meta = meta || jsonb_build_object('arrival_source', 'schedule') where id = t.id;
              insert into trip_events (company_id, trip_id, kind, detail) values (p_company, t.id, 'auto', 'Arrived by the clock — GPS did not confirm arrival (fallback)');
              n := n + 1;
            else
              select name into hname from harbours where id = t.destination_harbour_id;
              insert into dispatch_tasks (company_id, trip_id, title, detail, priority, due_at, meta)
                select p_company, t.id, left('Confirm arrival of ' || coalesce(t.code, 'trip'), 120),
                       'GPS has not confirmed arrival at ' || coalesce(hname, 'the destination harbour')
                         || '. Check with the captain, then mark Arrived (or correct the arrival time).',
                       'High', now(), jsonb_build_object('kind', 'arrival_unconfirmed')
                where not exists (select 1 from dispatch_tasks d where d.trip_id = t.id and d.meta->>'kind' = 'arrival_unconfirmed');
            end if;
          end if;
          continue;
        end if;
        update trips set status = 'Arrived', actual_arrive = coalesce(actual_arrive, arrive_at, now()),
                         meta = meta || jsonb_build_object('arrival_source', 'schedule') where id = t.id;
        insert into trip_events (company_id, trip_id, kind, detail) values (p_company, t.id, 'auto', 'Arrived automatically at arrival time');
        update bookings set status = 'Completed', updated_at = now() where trip_id = t.id and status in ('Confirmed', 'Checked in', 'Boarded');
        n := n + 1;
      exception when others then null;
      end;
    end loop;
  end if;
  return n;
end $$;
revoke execute on function ops_auto(uuid) from anon, public;

-- 10. Manual paths: Arrived pressed by hand, trip reopened, corrections -------------------------------------------
-- Any change of trips.status into Arrived/Completed without a current arrival event records one, so every arrival
-- has an audit row: manual (someone pressed it) or schedule_fallback (the clock did it, no GPS evidence).
create or replace function trips_arrival_sync() returns trigger
  language plpgsql security definer set search_path = public as
$$ declare m text;
begin
  if new.status is not distinct from old.status then return null; end if;
  if new.status in ('Arrived', 'Completed') and not trip_closed(old.status) then
    if not exists (select 1 from trip_arrival_events where trip_id = new.id and superseded_at is null) then
      m := case when auth.uid() is null or new.meta->>'arrival_source' = 'schedule' then 'schedule_fallback' else 'manual' end;
      insert into trip_arrival_events (company_id, trip_id, vessel_id, origin_harbour_id, destination_harbour_id, method, arrived_at,
                                       time_basis, algorithm_version, reason, created_by)
        values (new.company_id, new.id, new.vessel_id, new.origin_harbour_id, new.destination_harbour_id, m,
                coalesce(new.actual_arrive, now()), case when m = 'manual' then 'manual' else 'schedule' end, arrival_algorithm_version(),
                case when m = 'manual' then 'Marked ' || new.status || ' by hand' else 'Arrived by the clock (no GPS evidence)' end, auth.uid())
        on conflict do nothing;
    end if;
    insert into trip_arrival_state (trip_id, company_id, vessel_id, destination_harbour_id, state, reason)
      values (new.id, new.company_id, new.vessel_id, new.destination_harbour_id, 'ARRIVED', 'Trip ' || lower(new.status))
      on conflict (trip_id) do update set state = 'ARRIVED',
        reason = case when trip_arrival_state.state = 'ARRIVED' then trip_arrival_state.reason else excluded.reason end, updated_at = now();
  elsif trip_closed(old.status) and not trip_closed(new.status) then
    -- Reopened by hand (the automation never reopens): the old arrival no longer stands.
    update trip_arrival_events set superseded_at = now(), meta = meta || jsonb_build_object('superseded_reason', 'Trip reopened (' || new.status || ')')
      where trip_id = new.id and superseded_at is null;
    update trip_arrival_state set state = 'NOT_APPROACHING', reason = 'Trip reopened; waiting for GPS', pending_since = null,
           pending_count = 0, pending_first_obs = null, entry_after = null, updated_at = now()
      where trip_id = new.id;
    perform arrival_diag(new.company_id, new.id, new.vessel_id, null, 'reopened', 'Trip reopened to ' || new.status || '; arrival cleared');
  end if;
  return null;
end $$;
create trigger trp_arrival_sync after update of status on trips for each row execute function trips_arrival_sync();

-- Authorised correction (Operations): supersedes the current arrival, keeps it, and records who/why.
create or replace function correct_trip_arrival(p_trip uuid, p_arrived_at timestamptz, p_reason text) returns jsonb
  language plpgsql security definer set search_path = public as
$$ declare t trips; cur trip_arrival_events; nid uuid;
begin
  select * into t from trips where id = p_trip for update;
  if not found then raise exception 'Trip not found.'; end if;
  if not is_company_ops(t.company_id) then raise exception 'Only Operations can correct an arrival time.'; end if;
  if coalesce(btrim(p_reason), '') = '' then raise exception 'Say why the arrival time is being corrected.'; end if;
  if t.status = 'Cancelled' then raise exception 'This trip was cancelled.'; end if;
  if p_arrived_at is null or p_arrived_at > now() + interval '1 minute' then raise exception 'The arrival time cannot be in the future.'; end if;
  if p_arrived_at < coalesce(t.actual_depart, t.depart_at) then raise exception 'The arrival time cannot be before departure.'; end if;
  select * into cur from trip_arrival_events where trip_id = p_trip and superseded_at is null for update;
  if cur.id is not null then
    update trip_arrival_events set superseded_at = now() where id = cur.id;
  end if;
  insert into trip_arrival_events (company_id, trip_id, vessel_id, origin_harbour_id, destination_harbour_id, method, arrived_at,
                                   time_basis, evidence, algorithm_version, reason, created_by, supersedes)
    values (t.company_id, t.id, t.vessel_id, t.origin_harbour_id, t.destination_harbour_id, 'manual_correction', p_arrived_at,
            'manual', jsonb_build_object('previous_arrived_at', cur.arrived_at, 'previous_method', cur.method),
            arrival_algorithm_version(), left(btrim(p_reason), 300), auth.uid(), cur.id)
    returning id into nid;
  if cur.id is not null then update trip_arrival_events set superseded_by = nid where id = cur.id; end if;
  update trips set actual_arrive = p_arrived_at, status = case when trip_closed(status) then status else 'Arrived' end,
                   meta = meta || jsonb_build_object('arrival_source', 'manual_correction', 'arrival_event', nid)
    where id = p_trip;
  insert into trip_arrival_state (trip_id, company_id, vessel_id, destination_harbour_id, state, reason)
    values (t.id, t.company_id, t.vessel_id, t.destination_harbour_id, 'ARRIVED', 'Arrival time corrected by Operations')
    on conflict (trip_id) do update set state = 'ARRIVED', reason = excluded.reason, updated_at = now();
  insert into trip_events (company_id, trip_id, kind, detail, actor, meta)
    values (t.company_id, t.id, 'arrival', left('Arrival time corrected' || coalesce(' from ' || local_time(t.company_id, cur.arrived_at), '')
            || ' to ' || local_time(t.company_id, p_arrived_at) || ': ' || btrim(p_reason), 300), auth.uid(), jsonb_build_object('arrival_event', nid));
  return jsonb_build_object('event', nid, 'arrived_at', p_arrived_at);
end $$;
revoke execute on function correct_trip_arrival(uuid, timestamptz, text) from anon, public;
grant execute on function correct_trip_arrival(uuid, timestamptz, text) to authenticated;

-- 11. Read models -----------------------------------------------------------------------------------------------------
create or replace function arrival_label(p_state text) returns text
  language sql immutable as
$$ select case p_state when 'NOT_APPROACHING' then 'Tracking' when 'APPROACHING_DESTINATION' then 'Approaching destination'
                       when 'ARRIVAL_PENDING' then 'Arrival pending' when 'ARRIVED' then 'Arrived'
                       when 'TRACKING_UNAVAILABLE' then 'Tracking unavailable' when 'NOT_CONFIGURED' then 'Harbour not set'
                       else 'Not tracked' end $$;

-- Operations dashboard: arrival status for the day's trips and every trip still under way.
create or replace function ops_arrivals(p_company uuid, p_day date default null) returns jsonb
  language plpgsql stable security definer set search_path = public as
$$ declare tz text; d date; f timestamptz; tt timestamptz; out_j jsonb;
begin
  if not is_company_member(p_company) then raise exception 'Not a member of this company.'; end if;
  tz := company_tz(p_company);
  d := coalesce(p_day, (now() at time zone tz)::date);
  f := d::timestamp at time zone tz; tt := (d + 1)::timestamp at time zone tz;
  select coalesce(jsonb_agg(x order by x->>'depart_at'), '[]'::jsonb) into out_j from (
    select jsonb_build_object(
      'trip_id', t.id, 'code', t.code, 'status', t.status, 'route', r.name, 'origin', r.origin, 'destination', r.destination,
      'origin_harbour', ho.name, 'destination_harbour', hd.name, 'destination_harbour_id', t.destination_harbour_id,
      'vessel_id', t.vessel_id, 'vessel', v.name, 'depart_at', t.depart_at, 'arrive_at', t.arrive_at,
      'actual_depart', t.actual_depart, 'actual_arrive', t.actual_arrive,
      'state', st, 'label', arrival_label(st), 'reason', s.reason,
      'last_fix_at', s.last_obs_at, 'last_received_at', coalesce(s.last_any_received_at, s.last_received_at),
      'fresh_s', case when s.last_obs_at is not null then round(extract(epoch from (now() - s.last_obs_at)))::int end,
      'distance_m', s.last_distance_m, 'zone', s.last_zone, 'pending_count', s.pending_count, 'pending_since', s.pending_since,
      'method', e.method, 'arrived_at', e.arrived_at, 'arrived_after', e.arrived_after, 'uncertainty_s', e.uncertainty_s,
      'confirmed_at', e.confirmed_at, 'event_id', e.id,
      'delta_min', case when coalesce(e.arrived_at, t.actual_arrive) is not null and t.arrive_at is not null
                        then round(extract(epoch from (coalesce(e.arrived_at, t.actual_arrive) - t.arrive_at)) / 60)::int end,
      'local_arrival', case when e.arrived_at is not null then to_char(e.arrived_at at time zone tz, 'HH24:MI "on" FMDD FMMonth YYYY') end) x
    from trips t
      join routes r on r.id = t.route_id
      left join vessels v on v.id = t.vessel_id
      left join harbours ho on ho.id = t.origin_harbour_id
      left join harbours hd on hd.id = t.destination_harbour_id
      left join trip_arrival_state s on s.trip_id = t.id
      left join trip_arrival_events e on e.trip_id = t.id and e.superseded_at is null
      cross join lateral (select case
          when e.id is not null then 'ARRIVED'
          when t.status not in ('Departed', 'In transit') then null
          when t.destination_harbour_id is null then 'NOT_CONFIGURED'
          else coalesce(s.state, 'NOT_APPROACHING') end st) z
    where t.company_id = p_company
      and ((t.depart_at >= f and t.depart_at < tt) or t.status in ('Departed', 'In transit'))) q;
  return jsonb_build_object('day', d, 'tz', tz, 'now', now(), 'trips', out_j);
end $$;
revoke execute on function ops_arrivals(uuid, date) from anon, public;
grant execute on function ops_arrivals(uuid, date) to authenticated;

-- Why did this trip arrive / why is it still pending? Harbour rules, state, recent fixes, events, diagnostics.
create or replace function trip_arrival_detail(p_trip uuid) returns jsonb
  language plpgsql stable security definer set search_path = public as
$$ declare t trips; h harbours; ops boolean;
begin
  select * into t from trips where id = p_trip;
  if not found or not is_company_member(t.company_id) then raise exception 'Trip not found.'; end if;
  ops := is_company_ops(t.company_id) or t.captain_id = auth.uid() or exists (select 1 from trip_crew where trip_id = t.id and user_id = auth.uid());
  if t.destination_harbour_id is not null then select * into h from harbours where id = t.destination_harbour_id; end if;
  return jsonb_build_object(
    'trip', jsonb_build_object('id', t.id, 'code', t.code, 'status', t.status, 'arrive_at', t.arrive_at, 'actual_arrive', t.actual_arrive,
                               'actual_depart', t.actual_depart, 'arrival_source', t.meta->>'arrival_source'),
    'harbour', case when h.id is not null then jsonb_build_object('id', h.id, 'name', h.name, 'lat', h.lat, 'lng', h.lng,
                 'geofence_type', h.geofence_type, 'radius_m', h.radius_m, 'polygon', h.polygon, 'approach_m', h.approach_m,
                 'max_accuracy_m', h.max_accuracy_m, 'dwell_sec', h.dwell_sec, 'min_obs', h.min_obs, 'active', h.active) end,
    'config', arrival_cfg(t.company_id),
    'gps_managed', arrival_gps_managed(t.id),
    'state', (select to_jsonb(s) - 'company_id' from trip_arrival_state s where s.trip_id = t.id),
    'events', coalesce((select jsonb_agg(to_jsonb(e) - 'company_id' order by e.confirmed_at desc) from trip_arrival_events e where e.trip_id = t.id), '[]'::jsonb),
    'fixes', case when ops then coalesce((select jsonb_agg(jsonb_build_object('id', p.id, 'source', p.source, 'observed_at', p.observed_at,
               'received_at', p.received_at, 'time_basis', p.time_basis, 'lat', round(p.lat::numeric, 5), 'lng', round(p.lng::numeric, 5),
               'accuracy_m', p.accuracy_m, 'speed_kn', p.speed_kn, 'validity', p.validity, 'zone', p.zone, 'distance_m', p.distance_m)
               order by p.id desc) from (select * from vessel_positions where trip_id = t.id order by id desc limit 40) p), '[]'::jsonb)
             else '[]'::jsonb end,
    'diagnostics', case when is_company_ops(t.company_id) then coalesce((select jsonb_agg(jsonb_build_object('kind', g.kind, 'detail', g.detail,
               'at', g.at, 'obs_id', g.obs_id) order by g.id desc) from (select * from arrival_diagnostics where trip_id = t.id order by id desc limit 40) g), '[]'::jsonb)
             else '[]'::jsonb end);
end $$;
revoke execute on function trip_arrival_detail(uuid) from anon, public;
grant execute on function trip_arrival_detail(uuid) to authenticated;

-- Harbour admin "Test a point": what the engine would say for this position and accuracy.
create or replace function harbour_test_point(p_harbour uuid, p_lat float8, p_lng float8, p_accuracy_m float8 default null) returns jsonb
  language plpgsql stable security definer set search_path = public as
$$ declare h harbours; cfg jsonb; u float8;
begin
  select * into h from harbours where id = p_harbour;
  if not found or not is_company_member(h.company_id) then raise exception 'Harbour not found.'; end if;
  if p_lat is null or p_lng is null or p_lat not between -90 and 90 or p_lng not between -180 and 180 then raise exception 'Enter a valid latitude and longitude.'; end if;
  cfg := arrival_cfg(h.company_id);
  u := coalesce(p_accuracy_m, (cfg->>'assumedAccuracyM')::float8);
  return arrival_zone(to_jsonb(h), p_lat, p_lng, u) || jsonb_build_object(
    'accuracy_ok', u <= h.max_accuracy_m, 'accuracy_assumed', p_accuracy_m is null,
    'other_harbours', coalesce((select jsonb_agg(jsonb_build_object('name', o.name, 'zone', arrival_zone(to_jsonb(o), p_lat, p_lng, u)->>'zone'))
                       from harbours o where o.company_id = h.company_id and o.active and o.id <> h.id
                         and geo_distance_m(o.lat, o.lng, p_lat, p_lng) < o.approach_m), '[]'::jsonb));
end $$;
revoke execute on function harbour_test_point(uuid, float8, float8, float8) from anon, public;
grant execute on function harbour_test_point(uuid, float8, float8, float8) to authenticated;

-- Routes that still need harbours (never filled in automatically). Suggestions = active harbours whose name or island
-- name matches the route's text; an administrator must confirm them.
create or replace function harbour_config_gaps(p_company uuid) returns jsonb
  language plpgsql stable security definer set search_path = public as
$$ begin
  if not is_company_member(p_company) then raise exception 'Not a member of this company.'; end if;
  return jsonb_build_object(
    'routes', coalesce((select jsonb_agg(jsonb_build_object('id', r.id, 'name', r.name, 'origin', r.origin, 'destination', r.destination,
        'origin_harbour_id', r.origin_harbour_id, 'destination_harbour_id', r.destination_harbour_id,
        'origin_suggestions', (select coalesce(jsonb_agg(jsonb_build_object('id', h.id, 'name', h.name)), '[]'::jsonb) from harbours h left join islands i on i.id = h.island_id
                               where h.company_id = p_company and h.active and r.origin_harbour_id is null
                                 and lower(btrim(r.origin)) in (lower(h.name), lower(coalesce(i.name, '')))),
        'destination_suggestions', (select coalesce(jsonb_agg(jsonb_build_object('id', h.id, 'name', h.name)), '[]'::jsonb) from harbours h left join islands i on i.id = h.island_id
                               where h.company_id = p_company and h.active and r.destination_harbour_id is null
                                 and lower(btrim(r.destination)) in (lower(h.name), lower(coalesce(i.name, '')))))
        order by r.name)
      from routes r where r.company_id = p_company and r.active and (r.origin_harbour_id is null or r.destination_harbour_id is null)), '[]'::jsonb),
    'open_trips_without_harbour', (select count(*) from trips t where t.company_id = p_company and not trip_closed(t.status)
                                     and t.destination_harbour_id is null and t.depart_at > now() - interval '1 day'));
end $$;
revoke execute on function harbour_config_gaps(uuid) from anon, public;
grant execute on function harbour_config_gaps(uuid) to authenticated;
