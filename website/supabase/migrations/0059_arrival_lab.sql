-- Arrival Lab: algorithm testing for the platform owner (Claude, 28 Oct 2026). Applies after 0058.
--
-- Read-only. Nothing here writes trips, arrival events, positions or diagnostics.
--  1. arrival_simulate(harbour, track, rules, start) runs a drawn or replayed GPS track through the SAME pure functions
--     the live engine uses (arrival_check_obs → arrival_step, arrival_zone), with optional what-if overrides of the
--     harbour rules and the 3_arrival_detection settings, and returns the verdict for every fix.
--  2. arrival_lab_trips(company) lists recent trips that have stored GPS fixes; arrival_lab_trip_track(trip) returns a
--     trip's stored fixes as a track (plus what the live engine decided for each), so a real trip can be replayed
--     under different rules.
-- All three are platform owner only (is_platform_admin()).

-- Clamp what-if overrides to the same ranges the harbours table and arrival_cfg() allow.
create or replace function arrival_lab_rules(p_h jsonb, p_cfg jsonb, p_rules jsonb) returns jsonb
  language plpgsql immutable as
$$ declare h jsonb := coalesce(p_h, '{}'::jsonb); c jsonb := p_cfg; o jsonb; k text; v numeric;
  hlim constant jsonb := '{"radius_m":[20,3000],"approach_m":[200,50000],"max_accuracy_m":[5,500],"dwell_sec":[0,3600],"min_obs":[2,50]}';
  clim constant jsonb := '{"assumedAccuracyM":[5,500],"maxDelaySec":[30,86400],"maxFutureSec":[0,600],"maxGapSec":[30,3600],
    "trackingGapSec":[60,7200],"maxSpeedKn":[10,120],"passThroughKn":[0,60]}';
begin
  o := coalesce(p_rules->'harbour', '{}'::jsonb);
  if jsonb_typeof(o) <> 'object' then o := '{}'::jsonb; end if;
  for k in select jsonb_object_keys(hlim) loop
    continue when not o ? k;
    begin v := (o->>k)::numeric; exception when others then v := null; end;
    if v is not null then h := h || jsonb_build_object(k, round(greatest((hlim->k->>0)::numeric, least((hlim->k->>1)::numeric, v)))); end if;
  end loop;
  if o ? 'lat' and o ? 'lng' then h := h || jsonb_build_object('lat', (o->>'lat')::float8, 'lng', (o->>'lng')::float8); end if;
  if o->>'geofence_type' in ('circle', 'polygon') then h := h || jsonb_build_object('geofence_type', o->>'geofence_type'); end if;
  if jsonb_typeof(o->'polygon') = 'array' then h := h || jsonb_build_object('polygon', o->'polygon'); end if;
  if o ? 'name' then h := h || jsonb_build_object('name', left(o->>'name', 80)); end if;

  o := coalesce(p_rules->'cfg', '{}'::jsonb);
  if jsonb_typeof(o) <> 'object' then o := '{}'::jsonb; end if;
  for k in select jsonb_object_keys(clim) loop
    continue when not o ? k;
    begin v := (o->>k)::numeric; exception when others then v := null; end;
    if v is not null then c := c || jsonb_build_object(k, greatest((clim->k->>0)::numeric, least((clim->k->>1)::numeric, v))); end if;
  end loop;
  return jsonb_build_object('harbour', h, 'cfg', c);
end $$;

-- p_harbour: a saved harbour (its rules are the starting point), or null with p_rules.harbour giving a draft zone
--   {lat, lng, radius_m, approach_m, max_accuracy_m, dwell_sec, min_obs, geofence_type, polygon} and p_rules.company.
-- p_track: [{lat, lng, t (seconds after p_start), accuracy_m (null = unknown), speed_kn, delay_s (seconds until the
--   server receives it, default 0)}], at most 1000 fixes. Fixes are processed in the order given, like a live feed.
-- p_rules: {harbour: {...}, cfg: {...3_arrival_detection keys...}, company: uuid}. Out-of-range values are clamped.
create or replace function arrival_simulate(p_harbour uuid, p_track jsonb, p_rules jsonb default '{}'::jsonb,
                                            p_start timestamptz default null) returns jsonb
  language plpgsql stable security definer set search_path = public as
$$ declare hr harbours; cid uuid; hj jsonb; cfg jsonb; r jsonb; base timestamptz; st jsonb := '{"jump_rejects":0}'::jsonb;
  p jsonb; i int; obs jsonb; t timestamptz; recv timestamptz; why text; z jsonb; step jsonb; acc float8; u float8;
  steps jsonb := '[]'::jsonb; arr jsonb; la float8; lo float8; last_valid timestamptz; gap boolean; others jsonb; tz text;
  n_valid int := 0; n_rej int := 0;
begin
  if not is_platform_admin() then raise exception 'Only the platform owner can run arrival simulations.'; end if;
  if jsonb_typeof(p_track) <> 'array' then raise exception 'The track must be a list of fixes.'; end if;
  if jsonb_array_length(p_track) > 1000 then raise exception 'A track can have at most 1000 fixes.'; end if;
  p_rules := coalesce(p_rules, '{}'::jsonb);

  if p_harbour is not null then
    select * into hr from harbours where id = p_harbour;
    if not found then raise exception 'Harbour not found.'; end if;
    cid := hr.company_id;
    hj := to_jsonb(hr);
  else
    begin cid := (p_rules->>'company')::uuid; exception when others then cid := null; end;
    hj := jsonb_build_object('name', 'Draft harbour', 'geofence_type', 'circle', 'radius_m', 150, 'approach_m', 2000,
                             'max_accuracy_m', 50, 'dwell_sec', 60, 'min_obs', 3);
  end if;
  r := arrival_lab_rules(hj, arrival_cfg(cid), p_rules);
  hj := r->'harbour'; cfg := r->'cfg';
  if hj->>'lat' is null or hj->>'lng' is null then raise exception 'Give the harbour a pin (latitude and longitude).'; end if;
  if (hj->>'approach_m')::numeric <= (hj->>'radius_m')::numeric then raise exception 'The approach zone must be larger than the radius.'; end if;
  if hj->>'geofence_type' = 'polygon' and coalesce(jsonb_array_length(case when jsonb_typeof(hj->'polygon') = 'array' then hj->'polygon' end), 0) < 3 then
    raise exception 'A boundary needs at least 3 corner points.';
  end if;
  tz := case when cid is not null then company_tz(cid) else 'Indian/Maldives' end;
  base := date_trunc('second', coalesce(p_start, now()));

  for p, i in select x, n::int from jsonb_array_elements(p_track) with ordinality as e(x, n) loop
    begin t := base + make_interval(secs => (p->>'t')::float8); exception when others then t := null; end;
    recv := coalesce(t, base) + make_interval(secs => greatest(coalesce((p->>'delay_s')::float8, 0), 0));
    begin la := (p->>'lat')::float8; lo := (p->>'lng')::float8; exception when others then la := null; lo := null; end;
    begin acc := (p->>'accuracy_m')::float8; exception when others then acc := null; end;
    u := coalesce(acc, (cfg->>'assumedAccuracyM')::float8);
    obs := jsonb_build_object('id', i, 'lat', la, 'lng', lo, 'observed_at', t, 'accuracy_m', acc, 'speed_kn', p->'speed_kn');
    z := null; others := '[]'::jsonb;
    if la between -90 and 90 and lo between -180 and 180 then
      z := arrival_zone(hj, la, lo, u);
      if cid is not null then
        others := coalesce((select jsonb_agg(jsonb_build_object('id', o.id, 'name', o.name, 'zone', arrival_zone(to_jsonb(o), la, lo, u)->>'zone'))
                    from harbours o where o.company_id = cid and o.active and o.id is distinct from p_harbour
                      and geo_distance_m(o.lat, o.lng, la, lo) < o.approach_m), '[]'::jsonb);
      end if;
    end if;
    gap := last_valid is not null and t is not null and st->>'state' is distinct from 'ARRIVED'
           and extract(epoch from (t - last_valid)) > (cfg->>'trackingGapSec')::float8;

    if st->>'state' = 'ARRIVED' then
      why := 'after_arrival'; step := null;
    else
      why := arrival_check_obs(obs, st, hj, cfg, recv);
      step := null;
    end if;
    if why is null then
      step := arrival_step(st, obs, hj, cfg);
      st := step - 'zone_detail' - 'arrival' - 'event';
      last_valid := t; n_valid := n_valid + 1;
      if step->>'event' = 'confirmed' then arr := step->'arrival'; end if;
    else
      if why <> 'after_arrival' then n_rej := n_rej + 1; end if;
      if why = 'implausible_jump' then st := st || jsonb_build_object('jump_rejects', coalesce((st->>'jump_rejects')::int, 0) + 1); end if;
    end if;

    steps := steps || jsonb_build_array(jsonb_build_object(
      'i', i, 't', p->'t', 'observed_at', t, 'received_at', recv, 'lat', la, 'lng', lo,
      'accuracy_m', acc, 'accuracy_used', u, 'accuracy_assumed', acc is null, 'speed_kn', p->'speed_kn',
      'valid', why is null, 'reject', why,
      'zone', z->>'zone', 'distance_m', z->'distance_m', 'edge_m', z->'edge_m',
      'event', coalesce(step->>'event', 'none'), 'state', st->>'state',
      'reason', coalesce(step->>'reason', case when why = 'after_arrival' then 'Already arrived; later fixes change nothing'
                                                  when why is not null then 'Fix not used: ' || replace(why, '_', ' ') end),
      'pending_count', coalesce((st->>'pending_count')::int, 0),
      'dwell_s', case when st->>'pending_since' is not null and t is not null
                      then round(extract(epoch from (t - (st->>'pending_since')::timestamptz)))::int end,
      'tracking_gap_before', gap, 'other_harbours', others));
  end loop;

  return jsonb_build_object(
    'version', arrival_algorithm_version(), 'harbour', hj - 'meta' - 'created_by' - 'updated_by', 'cfg', cfg, 'tz', tz,
    'start', base, 'steps', steps, 'final_state', coalesce(st->>'state', 'NOT_APPROACHING'), 'final_reason', st->>'reason',
    'valid', n_valid, 'rejected', n_rej,
    'arrival', case when arr is not null then arr || jsonb_build_object(
      'local', to_char((arr->>'arrived_at')::timestamptz at time zone tz, 'HH24:MI:SS "on" FMDD FMMonth YYYY')) end);
end $$;
revoke execute on function arrival_simulate(uuid, jsonb, jsonb, timestamptz) from anon, public;
grant execute on function arrival_simulate(uuid, jsonb, jsonb, timestamptz) to authenticated;

-- Recent trips of a company that have stored GPS fixes (for replay).
create or replace function arrival_lab_trips(p_company uuid) returns jsonb
  language plpgsql stable security definer set search_path = public as
$$ begin
  if not is_platform_admin() then raise exception 'Only the platform owner can use the Arrival Lab.'; end if;
  return coalesce((select jsonb_agg(x order by x->>'depart_at' desc) from (
    select jsonb_build_object('id', t.id, 'code', t.code, 'status', t.status, 'depart_at', t.depart_at, 'arrive_at', t.arrive_at,
             'actual_arrive', t.actual_arrive, 'destination_harbour_id', t.destination_harbour_id,
             'origin_harbour_id', t.origin_harbour_id, 'vessel', v.name, 'fixes', n.fixes) as x
      from trips t join lateral (select count(*) as fixes from vessel_positions p where p.trip_id = t.id) n on n.fixes > 0
      left join vessels v on v.id = t.vessel_id
     where t.company_id = p_company
     order by t.depart_at desc limit 50) s), '[]'::jsonb);
end $$;
revoke execute on function arrival_lab_trips(uuid) from anon, public;
grant execute on function arrival_lab_trips(uuid) to authenticated;

-- A trip's stored fixes as a replayable track. t = seconds after the first fix; delay_s = how late the server got it.
-- 'live' keeps what the live engine decided (validity, zone) so the replay can be compared with it.
create or replace function arrival_lab_trip_track(p_trip uuid) returns jsonb
  language plpgsql stable security definer set search_path = public as
$$ declare t trips; t0 timestamptz;
begin
  if not is_platform_admin() then raise exception 'Only the platform owner can use the Arrival Lab.'; end if;
  select * into t from trips where id = p_trip;
  if not found then raise exception 'Trip not found.'; end if;
  select min(observed_at) into t0 from vessel_positions where trip_id = t.id;
  return jsonb_build_object('trip', jsonb_build_object('id', t.id, 'code', t.code, 'status', t.status, 'actual_arrive', t.actual_arrive,
                                                       'destination_harbour_id', t.destination_harbour_id, 'origin_harbour_id', t.origin_harbour_id),
    'start', t0,
    'event', (select jsonb_build_object('arrived_at', e.arrived_at, 'method', e.method, 'algorithm_version', e.algorithm_version)
                from trip_arrival_events e where e.trip_id = t.id and e.superseded_at is null limit 1),
    'track', coalesce((select jsonb_agg(jsonb_build_object(
        'lat', p.lat, 'lng', p.lng, 't', round(extract(epoch from (p.observed_at - t0))::numeric, 1),
        'accuracy_m', p.accuracy_m, 'speed_kn', p.speed_kn, 'source', p.source,
        'delay_s', greatest(round(extract(epoch from (p.received_at - p.observed_at))::numeric, 1), 0),
        'live', jsonb_build_object('validity', p.validity, 'zone', p.zone)) order by p.received_at, p.id)
      from (select * from vessel_positions where trip_id = t.id and observed_at is not null order by received_at, id limit 1000) p), '[]'::jsonb));
end $$;
revoke execute on function arrival_lab_trip_track(uuid) from anon, public;
grant execute on function arrival_lab_trip_track(uuid) to authenticated;
