-- Automatic harbour learning (Claude, 28 Oct 2026). Applies after 0059.
--
-- Harbours and route links no longer have to be drawn by hand. From the GPS the system already collects:
--  1. Stops: wherever a vessel stays within stopRadiusM for at least stopMinSec, a vessel_stops row is recorded and
--     matched to the trip that arrived there (destination) or left from there (origin).
--  2. Candidates: stops outside every known harbour are grouped (within mergeRadiusM) into harbour_candidates.
--  3. Auto harbours: a candidate with at least learnMinStops stops on learnMinDays different days, at least one of them
--     tied to a trip, becomes a harbour (radius from how spread the stops are, name from the route text). meta.auto = true.
--  4. Auto route links: a route without an origin / destination harbour gets the harbour most of its trips actually
--     started / ended at (≥ 2 trips and ≥ 60 %), or — when no GPS evidence exists — the one harbour whose name or island
--     matches the route text exactly. Manual links are never overwritten.
--  5. Every automatic change is logged in harbour_learning_log and can be undone (harbour_learning_undo). An undone
--     harbour leaves a dismissed candidate so the same spot is not learned again; an undone link is not re-made.
-- Also: arrival_poll_followme (0058) now also polls vessels that are under way without a harbour, and the 20 minutes
-- before departure and after arrival, so there is GPS to learn from. Learning runs every 10 minutes (pg_cron) and on
-- demand (harbour_learn_now). Settings live in 3_arrival_detection: autoLearn, autoLink, nameLinks, learnMinStops,
-- learnMinDays, stopRadiusM, stopMinSec, mergeRadiusM (see harbour_learn_cfg).

-- 0. Settings ---------------------------------------------------------------------------------------------------------
create or replace function harbour_learn_cfg(p_company uuid) returns jsonb
  language plpgsql stable security definer set search_path = public as
$$ declare s jsonb; k text; v numeric; out jsonb;
  d constant jsonb := '{"autoLearn":true,"autoLink":true,"nameLinks":true,"learnMinStops":3,"learnMinDays":2,
                        "stopRadiusM":80,"stopMinSec":240,"mergeRadiusM":150}';
  lim constant jsonb := '{"learnMinStops":[2,50],"learnMinDays":[1,30],"stopRadiusM":[20,500],"stopMinSec":[60,7200],"mergeRadiusM":[50,1000]}';
begin
  s := company_setting(p_company, '3_arrival_detection');
  if s is null or jsonb_typeof(s) <> 'object' then s := '{}'::jsonb; end if;
  out := d;
  for k in select jsonb_object_keys(d) loop
    continue when not s ? k;
    if lim ? k then
      begin v := (s->>k)::numeric; exception when others then v := null; end;
      if v is not null then out := out || jsonb_build_object(k, round(greatest((lim->k->>0)::numeric, least((lim->k->>1)::numeric, v)))); end if;
    elsif jsonb_typeof(s->k) = 'boolean' then
      out := out || jsonb_build_object(k, s->k);
    end if;
  end loop;
  return out;
end $$;
revoke execute on function harbour_learn_cfg(uuid) from anon, public;
grant execute on function harbour_learn_cfg(uuid) to authenticated;

-- Name comparison: case, accents and punctuation ignored ("Malé" = "male" = "MALE ").
create or replace function learn_norm(p text) returns text
  language sql immutable as
$$ select regexp_replace(lower(translate(coalesce(p, ''), 'áàâäãéèêëíìîïóòôöõúùûüçñÁÀÂÄÃÉÈÊËÍÌÎÏÓÒÔÖÕÚÙÛÜÇÑ',
                                                        'aaaaaeeeeiiiiooooouuuucnaaaaaeeeeiiiiooooouuuucn')), '[^a-z0-9]+', '', 'g') $$;

-- 1. Tables -----------------------------------------------------------------------------------------------------------
create table vessel_stops (
  id              bigint generated always as identity primary key,
  company_id      uuid not null references companies(id) on delete cascade,
  vessel_id       uuid not null references vessels(id) on delete cascade,
  lat             double precision not null,
  lng             double precision not null,
  started_at      timestamptz not null,
  ended_at        timestamptz not null,
  fixes           integer not null,
  spread_m        real not null,                                   -- furthest fix from the stop centre
  harbour_id      uuid references harbours(id) on delete set null, -- a known harbour this stop is at
  arrive_trip_id  uuid references trips(id) on delete set null,    -- the trip that ended here
  arrive_route_id uuid references routes(id) on delete set null,
  depart_trip_id  uuid references trips(id) on delete set null,    -- the trip that left from here
  depart_route_id uuid references routes(id) on delete set null,
  unique (vessel_id, started_at)
);
create index vstop_company on vessel_stops (company_id, started_at desc);
create index vstop_harbour on vessel_stops (harbour_id) where harbour_id is not null;
create index vstop_arrive_route on vessel_stops (arrive_route_id) where arrive_route_id is not null;
create index vstop_depart_route on vessel_stops (depart_route_id) where depart_route_id is not null;
alter table vessel_stops enable row level security;
create policy vstop_select on vessel_stops for select to authenticated using (is_company_ops(company_id));

create table harbour_candidates (
  id          uuid primary key default gen_random_uuid(),
  company_id  uuid not null references companies(id) on delete cascade,
  lat         double precision not null,
  lng         double precision not null,
  radius_m    integer not null default 150,
  stops       integer not null default 0,
  trip_stops  integer not null default 0,   -- stops tied to a trip arriving or leaving
  vessels     integer not null default 0,
  days        integer not null default 0,
  spread_m    real not null default 0,      -- 90th percentile distance of its stops from the centre
  name_guess  text,
  stop_ids    bigint[] not null default '{}',
  status      text not null default 'learning' check (status in ('learning', 'created', 'dismissed', 'conflict')),
  harbour_id  uuid references harbours(id) on delete set null,
  detail      text,
  first_seen  timestamptz,
  last_seen   timestamptz,
  updated_at  timestamptz not null default now()
);
create index hcand_company on harbour_candidates (company_id, status);
alter table harbour_candidates enable row level security;
create policy hcand_select on harbour_candidates for select to authenticated using (is_company_ops(company_id));

create table harbour_learning_log (
  id          bigint generated always as identity primary key,
  company_id  uuid not null references companies(id) on delete cascade,
  at          timestamptz not null default now(),
  kind        text not null check (kind in ('harbour_created', 'route_linked', 'candidate_conflict')),
  harbour_id  uuid references harbours(id) on delete set null,
  route_id    uuid references routes(id) on delete set null,
  field       text check (field is null or field in ('origin', 'destination')),
  method      text,                          -- gps / name
  detail      text not null,
  evidence    jsonb not null default '{}'::jsonb,
  undone_at   timestamptz,
  undone_by   uuid references auth.users(id) on delete set null
);
create index hlog_company on harbour_learning_log (company_id, at desc);
alter table harbour_learning_log enable row level security;
create policy hlog_select on harbour_learning_log for select to authenticated using (is_company_ops(company_id));

create table harbour_learn_state (
  company_id   uuid primary key references companies(id) on delete cascade,
  last_run_at  timestamptz,
  last_pos_id  bigint not null default 0,    -- vessel_positions already turned into stops
  summary      jsonb not null default '{}'::jsonb
);
alter table harbour_learn_state enable row level security;
create policy hls_select on harbour_learn_state for select to authenticated using (is_company_ops(company_id));

-- 2. Stops for one vessel from p_from on (rebuilt, so a stop still in progress grows run after run) -------------------
create or replace function harbour_learn_stops(p_company uuid, p_vessel uuid, p_from timestamptz, p_cfg jsonb) returns integer
  language plpgsql security definer set search_path = public as
$$ declare from_ts timestamptz; p record; n int := 0; c_n int := 0; c_lat float8; c_lng float8; c_first timestamptz; c_last timestamptz;
  c_spread float8 := 0; d float8; rad float8 := (p_cfg->>'stopRadiusM')::float8; min_s float8 := (p_cfg->>'stopMinSec')::float8;
  prev_at timestamptz;
begin
  select least(p_from, coalesce(min(started_at), p_from)) into from_ts from vessel_stops where vessel_id = p_vessel and ended_at >= p_from;
  delete from vessel_stops where vessel_id = p_vessel and started_at >= from_ts;
  for p in select lat, lng, coalesce(observed_at, received_at) as at from vessel_positions
            where vessel_id = p_vessel and coalesce(observed_at, received_at) >= from_ts
              and lat between -90 and 90 and lng between -180 and 180 and not (lat = 0 and lng = 0)
              and validity not in ('invalid_coordinates', 'implausible_jump', 'future_time', 'missing_time', 'invalid_accuracy')
            order by coalesce(observed_at, received_at), id loop
    continue when prev_at is not null and p.at = prev_at;
    prev_at := p.at;
    if c_n > 0 then d := geo_distance_m(c_lat, c_lng, p.lat, p.lng); end if;
    if c_n > 0 and d <= rad and extract(epoch from (p.at - c_last)) <= 900 then
      c_lat := (c_lat * c_n + p.lat) / (c_n + 1); c_lng := (c_lng * c_n + p.lng) / (c_n + 1);
      c_n := c_n + 1; c_last := p.at; c_spread := greatest(c_spread, d);
    else
      if c_n >= 3 and extract(epoch from (c_last - c_first)) >= min_s then
        insert into vessel_stops (company_id, vessel_id, lat, lng, started_at, ended_at, fixes, spread_m)
          values (p_company, p_vessel, c_lat, c_lng, c_first, c_last, c_n, c_spread) on conflict (vessel_id, started_at) do nothing;
        n := n + 1;
      end if;
      c_n := 1; c_lat := p.lat; c_lng := p.lng; c_first := p.at; c_last := p.at; c_spread := 0;
    end if;
  end loop;
  if c_n >= 3 and extract(epoch from (c_last - c_first)) >= min_s then
    insert into vessel_stops (company_id, vessel_id, lat, lng, started_at, ended_at, fixes, spread_m)
      values (p_company, p_vessel, c_lat, c_lng, c_first, c_last, c_n, c_spread) on conflict (vessel_id, started_at) do nothing;
    n := n + 1;
  end if;
  -- Which trip ended here, and which left from here (same vessel, nearest in time).
  update vessel_stops s set
      (arrive_trip_id, arrive_route_id) = (select t.id, t.route_id from trips t
         where t.vessel_id = s.vessel_id and t.status <> 'Cancelled' and coalesce(t.actual_depart, t.depart_at) < s.started_at
           and abs(extract(epoch from (coalesce(t.actual_arrive, t.arrive_at) - s.started_at))) <= 2700
         order by abs(extract(epoch from (coalesce(t.actual_arrive, t.arrive_at) - s.started_at))) limit 1),
      (depart_trip_id, depart_route_id) = (select t.id, t.route_id from trips t
         where t.vessel_id = s.vessel_id and t.status <> 'Cancelled'
           and abs(extract(epoch from (coalesce(t.actual_depart, t.depart_at) - s.ended_at))) <= 1800
         order by abs(extract(epoch from (coalesce(t.actual_depart, t.depart_at) - s.ended_at))) limit 1)
   where s.vessel_id = p_vessel and s.started_at >= from_ts;
  return n;
end $$;
revoke execute on function harbour_learn_stops(uuid, uuid, timestamptz, jsonb) from anon, public, authenticated;

-- 3. One learning run for a company ------------------------------------------------------------------------------------
create or replace function harbour_learn(p_company uuid, p_now timestamptz default null) returns jsonb
  language plpgsql security definer set search_path = public as
$$ declare cfg jsonb := harbour_learn_cfg(p_company); st harbour_learn_state; vrow record; stp record; cand record; rt record;
  now_ts timestamptz := coalesce(p_now, now()); tz text := company_tz(p_company); max_pos bigint; merge float8;
  new_stops int := 0; created int := 0; linked int := 0; conflicts int := 0; cid uuid; nm text; base text; k int; isl uuid;
  rad int; hid uuid; best_h uuid; best_n int; names uuid[]; total int; fld text; other uuid; v_summary jsonb;
begin
  if not coalesce((cfg->>'autoLearn')::boolean, true) then return jsonb_build_object('skipped', 'autoLearn is off'); end if;
  perform pg_advisory_xact_lock(hashtext('harbour_learn:' || p_company::text));
  insert into harbour_learn_state (company_id) values (p_company) on conflict do nothing;
  select * into st from harbour_learn_state where company_id = p_company for update;
  merge := (cfg->>'mergeRadiusM')::float8;

  -- Stops: only vessels with new fixes since the last run, rebuilt from 3 hours before their first new fix.
  select coalesce(max(id), st.last_pos_id) into max_pos from vessel_positions where company_id = p_company;
  for vrow in select vessel_id, min(coalesce(observed_at, received_at)) as first_at from vessel_positions
            where company_id = p_company and id > st.last_pos_id and id <= max_pos group by vessel_id loop
    new_stops := new_stops + harbour_learn_stops(p_company, vrow.vessel_id, vrow.first_at - interval '3 hours', cfg);
  end loop;

  -- Stops at a known harbour belong to it.
  update vessel_stops s set harbour_id = (
      select hb.id from harbours hb where hb.company_id = p_company and hb.active
         and geo_distance_m(hb.lat, hb.lng, s.lat, s.lng) <= harbour_reach_m(hb.geofence_type, hb.radius_m, hb.polygon, hb.lat, hb.lng) + 100
       order by geo_distance_m(hb.lat, hb.lng, s.lat, s.lng) limit 1)
   where s.company_id = p_company;

  -- Candidates: rebuilt from the stops that are at no known harbour and not where a learned harbour was undone.
  delete from harbour_candidates where company_id = p_company and status in ('learning', 'conflict');
  for stp in select * from vessel_stops vs where vs.company_id = p_company and vs.harbour_id is null
             and not exists (select 1 from harbour_candidates d where d.company_id = p_company and d.status = 'dismissed'
                              and geo_distance_m(d.lat, d.lng, vs.lat, vs.lng) <= d.radius_m + merge)
           order by vs.started_at, vs.id loop
    select id into cid from harbour_candidates c2 where c2.company_id = p_company and c2.status = 'learning'
       and geo_distance_m(c2.lat, c2.lng, stp.lat, stp.lng) <= merge
     order by geo_distance_m(c2.lat, c2.lng, stp.lat, stp.lng) limit 1;
    if cid is null then
      insert into harbour_candidates (company_id, lat, lng, stops, stop_ids) values (p_company, stp.lat, stp.lng, 1, array[stp.id]);
    else
      update harbour_candidates set lat = (lat * stops + stp.lat) / (stops + 1), lng = (lng * stops + stp.lng) / (stops + 1),
             stops = stops + 1, stop_ids = stop_ids || stp.id where id = cid;
    end if;
  end loop;
  update harbour_candidates c set
      (trip_stops, vessels, days, spread_m, first_seen, last_seen) = (
        select count(*) filter (where vs.arrive_route_id is not null or vs.depart_route_id is not null),
               count(distinct vs.vessel_id), count(distinct (vs.started_at at time zone tz)::date),
               coalesce(percentile_cont(0.9) within group (order by geo_distance_m(c.lat, c.lng, vs.lat, vs.lng) + vs.spread_m), 0),
               min(vs.started_at), max(vs.ended_at)
          from vessel_stops vs where vs.id = any(c.stop_ids)),
      name_guess = (select mode() within group (order by nm2) from (
                select ra.destination as nm2 from vessel_stops s2 join routes ra on ra.id = s2.arrive_route_id where s2.id = any(c.stop_ids)
                union all
                select rd.origin from vessel_stops s3 join routes rd on rd.id = s3.depart_route_id where s3.id = any(c.stop_ids)) names),
      updated_at = now_ts
   where c.company_id = p_company and c.status = 'learning';
  update harbour_candidates set radius_m = least(400, greatest(60, (ceil((spread_m + 30) / 10) * 10)::int))
   where company_id = p_company and status = 'learning';

  -- Auto harbours.
  for cand in select * from harbour_candidates where company_id = p_company and status = 'learning'
             and stops >= (cfg->>'learnMinStops')::int and days >= (cfg->>'learnMinDays')::int and trip_stops >= 1 and spread_m <= 400
           order by stops desc loop
    base := coalesce(nullif(btrim(cand.name_guess), ''), 'Harbour ' || round(cand.lat::numeric, 4) || ', ' || round(cand.lng::numeric, 4));
    nm := left(base, 76); k := 1;
    while exists (select 1 from harbours where company_id = p_company and lower(btrim(name)) = lower(nm)) loop
      k := k + 1; nm := left(base, 72) || ' ' || k;
    end loop;
    isl := null;
    if cand.name_guess is not null then
      select id into isl from islands where company_id = p_company and learn_norm(name) = learn_norm(cand.name_guess) limit 1;
      if isl is null then
        insert into islands (company_id, name) values (p_company, left(btrim(cand.name_guess), 80)) on conflict do nothing returning id into isl;
      end if;
    end if;
    rad := cand.radius_m;
    begin
      insert into harbours (company_id, island_id, name, lat, lng, radius_m, approach_m, meta)
        values (p_company, isl, nm, cand.lat, cand.lng, rad, greatest(2000, rad * 5),
                jsonb_build_object('auto', true, 'learned_at', now_ts, 'candidate', cand.id,
                                   'evidence', jsonb_build_object('stops', cand.stops, 'trip_stops', cand.trip_stops, 'vessels', cand.vessels,
                                                                  'days', cand.days, 'spread_m', round(cand.spread_m::numeric))))
        returning id into hid;
      update harbour_candidates set status = 'created', harbour_id = hid, detail = 'Harbour created automatically' where id = cand.id;
      update vessel_stops set harbour_id = hid where id = any(cand.stop_ids);
      insert into harbour_learning_log (company_id, kind, harbour_id, method, detail, evidence)
        values (p_company, 'harbour_created', hid, 'gps',
                format('Learned %s from %s stop%s on %s day%s (%s vessel%s), %s m zone', nm, cand.stops, case when cand.stops = 1 then '' else 's' end,
                       cand.days, case when cand.days = 1 then '' else 's' end, cand.vessels, case when cand.vessels = 1 then '' else 's' end, rad),
                jsonb_build_object('candidate', cand.id, 'lat', cand.lat, 'lng', cand.lng, 'stops', cand.stops, 'days', cand.days, 'vessels', cand.vessels,
                                   'trip_stops', cand.trip_stops, 'spread_m', round(cand.spread_m::numeric), 'radius_m', rad));
      created := created + 1;
    exception when others then
      update harbour_candidates set status = 'conflict', detail = left(sqlerrm, 200) where id = cand.id;
      conflicts := conflicts + 1;
    end;
  end loop;

  -- Auto route links (only empty ends; never ones a person set or undid).
  if coalesce((cfg->>'autoLink')::boolean, true) then
    for rt in select * from routes where company_id = p_company and active and (origin_harbour_id is null or destination_harbour_id is null) loop
      foreach fld in array array['destination', 'origin'] loop
        continue when (fld = 'destination' and rt.destination_harbour_id is not null) or (fld = 'origin' and rt.origin_harbour_id is not null);
        continue when coalesce((rt.meta->>('auto_off_' || fld))::boolean, false);
        other := case when fld = 'destination' then rt.origin_harbour_id else rt.destination_harbour_id end;
        best_h := null; best_n := 0;
        select count(*) into total from vessel_stops
          where harbour_id is not null and ((fld = 'destination' and arrive_route_id = rt.id) or (fld = 'origin' and depart_route_id = rt.id));
        if total > 0 then
          select harbour_id, count(*) into best_h, best_n from vessel_stops
            where harbour_id is not null and ((fld = 'destination' and arrive_route_id = rt.id) or (fld = 'origin' and depart_route_id = rt.id))
            group by harbour_id order by count(*) desc limit 1;
          if best_n < 2 or best_n::float8 / total < 0.6 then best_h := null; end if;
        end if;
        if best_h is not null and best_h is distinct from other then
          hid := best_h;
          execute format('update routes set %I = $1 where id = $2', fld || '_harbour_id') using hid, rt.id;
          insert into harbour_learning_log (company_id, kind, harbour_id, route_id, field, method, detail, evidence)
            values (p_company, 'route_linked', hid, rt.id, fld, 'gps',
                    format('%s: %s harbour set to %s (%s of %s trips %s there)', rt.name, fld, (select name from harbours where id = hid), best_n, total,
                           case when fld = 'destination' then 'ended' else 'started' end),
                    jsonb_build_object('trips', best_n, 'of', total));
          linked := linked + 1;
          if fld = 'destination' then rt.destination_harbour_id := hid; else rt.origin_harbour_id := hid; end if;
        elsif total = 0 and coalesce((cfg->>'nameLinks')::boolean, true) then
          select array_agg(distinct hb.id) into names from harbours hb left join islands i on i.id = hb.island_id
           where hb.company_id = p_company and hb.active
             and learn_norm(case when fld = 'destination' then rt.destination else rt.origin end) <> ''
             and learn_norm(case when fld = 'destination' then rt.destination else rt.origin end) in (learn_norm(hb.name), learn_norm(i.name));
          if array_length(names, 1) = 1 and names[1] is distinct from other then
            hid := names[1];
            execute format('update routes set %I = $1 where id = $2', fld || '_harbour_id') using hid, rt.id;
            insert into harbour_learning_log (company_id, kind, harbour_id, route_id, field, method, detail, evidence)
              values (p_company, 'route_linked', hid, rt.id, fld, 'name',
                      format('%s: %s harbour set to %s (name match; no GPS yet)', rt.name, fld, (select name from harbours where id = hid)),
                      jsonb_build_object('text', case when fld = 'destination' then rt.destination else rt.origin end));
            linked := linked + 1;
            if fld = 'destination' then rt.destination_harbour_id := hid; else rt.origin_harbour_id := hid; end if;
          end if;
        end if;
      end loop;
    end loop;
  end if;

  v_summary := jsonb_build_object('at', now_ts, 'new_stops', new_stops, 'harbours_created', created, 'routes_linked', linked, 'conflicts', conflicts,
    'candidates', (select count(*) from harbour_candidates where company_id = p_company and status = 'learning'));
  update harbour_learn_state set last_run_at = now_ts, last_pos_id = max_pos, summary = v_summary where company_id = p_company;
  return v_summary;
end $$;
revoke execute on function harbour_learn(uuid, timestamptz) from anon, public, authenticated;

-- Every company that has learning on and something to learn from (pg_cron, every 10 minutes).
create or replace function harbour_learn_all() returns integer
  language plpgsql security definer set search_path = public as
$$ declare c record; n int := 0;
begin
  for c in select co.id from companies co
            where exists (select 1 from vessel_positions p where p.company_id = co.id
                           and p.id > coalesce((select last_pos_id from harbour_learn_state s where s.company_id = co.id), 0))
               or (exists (select 1 from routes r where r.company_id = co.id and r.active and (r.origin_harbour_id is null or r.destination_harbour_id is null))
                   and coalesce((select last_run_at from harbour_learn_state s where s.company_id = co.id), '-infinity') < now() - interval '1 hour') loop
    begin
      perform harbour_learn(c.id);
      n := n + 1;
    exception when others then
      raise log 'harbour learning failed for %: %', c.id, sqlerrm;
    end;
  end loop;
  return n;
end $$;
revoke execute on function harbour_learn_all() from anon, public, authenticated;

-- Operations (and the platform owner) can run it now from the Harbours screen.
create or replace function harbour_learn_now(p_company uuid) returns jsonb
  language plpgsql security definer set search_path = public as
$$ begin
  if not is_company_ops(p_company) then raise exception 'Only Operations can run harbour learning.'; end if;
  return harbour_learn(p_company);
end $$;
revoke execute on function harbour_learn_now(uuid) from anon, public;
grant execute on function harbour_learn_now(uuid) to authenticated;

-- 4. Undo an automatic change -----------------------------------------------------------------------------------------
create or replace function harbour_learning_undo(p_log bigint) returns jsonb
  language plpgsql security definer set search_path = public as
$$ declare l harbour_learning_log; hb harbours; used boolean; res text;
begin
  select * into l from harbour_learning_log where id = p_log for update;
  if not found or not is_company_ops(l.company_id) then raise exception 'Change not found.'; end if;
  if l.undone_at is not null then raise exception 'That change was already undone.'; end if;
  if l.kind = 'route_linked' then
    execute format('update routes set %I = null, meta = meta || jsonb_build_object(%L, true) where id = $1 and %I = $2',
                   l.field || '_harbour_id', 'auto_off_' || l.field, l.field || '_harbour_id') using l.route_id, l.harbour_id;
    res := 'Route link removed; it will not be made again automatically.';
  elsif l.kind = 'harbour_created' then
    select * into hb from harbours where id = l.harbour_id for update;
    if found then
      update routes set origin_harbour_id = null, meta = meta || '{"auto_off_origin": true}' where origin_harbour_id = hb.id;
      update routes set destination_harbour_id = null, meta = meta || '{"auto_off_destination": true}' where destination_harbour_id = hb.id;
      used := exists (select 1 from trip_arrival_events where origin_harbour_id = hb.id or destination_harbour_id = hb.id)
           or exists (select 1 from trips where (origin_harbour_id = hb.id or destination_harbour_id = hb.id) and trip_closed(status));
      update trips set origin_harbour_id = null where origin_harbour_id = hb.id and not trip_closed(status);
      update trips set destination_harbour_id = null where destination_harbour_id = hb.id and not trip_closed(status);
      update harbour_learning_log set undone_at = now(), undone_by = auth.uid()
        where company_id = l.company_id and kind = 'route_linked' and harbour_id = hb.id and undone_at is null;
      if used then
        update harbours set active = false, meta = meta || '{"auto_undone": true}' where id = hb.id;
        res := 'Harbour switched off (past trips use it, so it was kept).';
      else
        delete from harbours where id = hb.id;
        res := 'Harbour removed.';
      end if;
    end if;
    update harbour_candidates set status = 'dismissed', harbour_id = null, detail = 'Undone by a person'
      where id = (l.evidence->>'candidate')::uuid;
    res := coalesce(res, 'Harbour was already gone.') || ' This spot will not be learned again.';
  else
    raise exception 'That change cannot be undone.';
  end if;
  update harbour_learning_log set undone_at = now(), undone_by = auth.uid() where id = l.id;
  return jsonb_build_object('ok', true, 'message', res);
end $$;
revoke execute on function harbour_learning_undo(bigint) from anon, public;
grant execute on function harbour_learning_undo(bigint) to authenticated;

-- Let a dismissed spot be learned again.
create or replace function harbour_candidate_restore(p_candidate uuid) returns void
  language plpgsql security definer set search_path = public as
$$ declare c harbour_candidates;
begin
  select * into c from harbour_candidates where id = p_candidate;
  if not found or not is_company_ops(c.company_id) then raise exception 'Candidate not found.'; end if;
  delete from harbour_candidates where id = c.id and status = 'dismissed';
end $$;
revoke execute on function harbour_candidate_restore(uuid) from anon, public;
grant execute on function harbour_candidate_restore(uuid) to authenticated;

-- 5. What the Harbours screen shows ------------------------------------------------------------------------------------
create or replace function harbour_learning_status(p_company uuid) returns jsonb
  language plpgsql stable security definer set search_path = public as
$$ declare cfg jsonb := harbour_learn_cfg(p_company); st harbour_learn_state;
begin
  if not is_company_ops(p_company) then raise exception 'Only Operations can see harbour learning.'; end if;
  select * into st from harbour_learn_state where company_id = p_company;
  return jsonb_build_object(
    'cfg', cfg, 'last_run_at', st.last_run_at, 'summary', coalesce(st.summary, '{}'::jsonb),
    'tracked_vessels', (select count(*) from followme_links l join vessels v on v.id = l.vessel_id where v.company_id = p_company),
    'vessels', (select count(*) from vessels where company_id = p_company),
    'fixes_24h', (select count(*) from vessel_positions where company_id = p_company and received_at > now() - interval '24 hours'),
    'stops_total', (select count(*) from vessel_stops where company_id = p_company),
    'stops_at_harbours', (select count(*) from vessel_stops where company_id = p_company and harbour_id is not null),
    'routes_total', (select count(*) from routes where company_id = p_company and active),
    'routes_complete', (select count(*) from routes where company_id = p_company and active and origin_harbour_id is not null and destination_harbour_id is not null),
    'open_trips_without_harbour', (select count(*) from trips where company_id = p_company and not trip_closed(status) and destination_harbour_id is null),
    'candidates', coalesce((select jsonb_agg(jsonb_build_object('id', c.id, 'lat', c.lat, 'lng', c.lng, 'radius_m', c.radius_m, 'stops', c.stops,
        'trip_stops', c.trip_stops, 'vessels', c.vessels, 'days', c.days, 'spread_m', round(c.spread_m::numeric), 'name_guess', c.name_guess,
        'status', c.status, 'detail', c.detail, 'last_seen', c.last_seen,
        'progress', least(1, least(c.stops::numeric / (cfg->>'learnMinStops')::numeric, c.days::numeric / (cfg->>'learnMinDays')::numeric)
                             * case when c.trip_stops > 0 then 1 else 0.9 end)) order by c.stops desc)
      from harbour_candidates c where c.company_id = p_company and c.status in ('learning', 'conflict', 'dismissed')), '[]'::jsonb),
    'stops', coalesce((select jsonb_agg(jsonb_build_object('lat', s.lat, 'lng', s.lng, 'h', s.harbour_id is not null, 'at', s.started_at,
        'min', round(extract(epoch from (s.ended_at - s.started_at)) / 60)) order by s.started_at desc)
      from (select * from vessel_stops where company_id = p_company order by started_at desc limit 300) s), '[]'::jsonb),
    'log', coalesce((select jsonb_agg(jsonb_build_object('id', l.id, 'at', l.at, 'kind', l.kind, 'detail', l.detail, 'method', l.method,
        'harbour_id', l.harbour_id, 'route_id', l.route_id, 'field', l.field, 'undone_at', l.undone_at) order by l.at desc)
      from (select * from harbour_learning_log where company_id = p_company order by at desc limit 40) l), '[]'::jsonb));
end $$;
revoke execute on function harbour_learning_status(uuid) from anon, public;
grant execute on function harbour_learning_status(uuid) to authenticated;

-- 6. FollowMe poll (0058) now also feeds learning ----------------------------------------------------------------------
-- Vessels under way (with or without a destination harbour), and with learning on also the 20 minutes before departure
-- and after arrival, when boats sit at the berth. Round robin by least recently tried link; followme_fetch_core still
-- makes at most one outside call per company per minute (other vessels get the cache, a duplicate that is ignored).
create or replace function arrival_poll_followme(p_company uuid) returns integer
  language plpgsql security definer set search_path = public as
$$ declare r record; res jsonb; pos jsonb; tm jsonb; n int := 0; tz text := company_tz(p_company);
  learn boolean := coalesce((harbour_learn_cfg(p_company)->>'autoLearn')::boolean, true);
begin
  for r in select x.* from (
             select distinct on (t.vessel_id) t.vessel_id, v.name vname, c.tried_at,
                    case when t.status in ('Departed', 'In transit') then t.id end as trip_id
               from trips t
               join vessels v on v.id = t.vessel_id
               join followme_links l on l.vessel_id = t.vessel_id
               left join followme_cache c on c.company_id = t.company_id and c.url = l.url
              where t.company_id = p_company
                and ((t.status in ('Departed', 'In transit') and (t.destination_harbour_id is not null or learn))
                  or (learn and t.status not in ('Cancelled', 'Departed', 'In transit')
                      and (t.depart_at between now() - interval '5 minutes' and now() + interval '20 minutes'
                           or coalesce(t.actual_arrive, t.arrive_at) between now() - interval '20 minutes' and now() + interval '5 minutes')))
              order by t.vessel_id, (t.status in ('Departed', 'In transit')) desc, t.depart_at desc) x
           order by x.tried_at nulls first limit 10 loop
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

-- 7. Schedule (only where pg_cron exists, i.e. on Supabase) -----------------------------------------------------------
do $$ begin
  if exists (select 1 from pg_extension where extname = 'pg_cron') then
    perform cron.unschedule(jobid) from cron.job where jobname = 'veyora_harbour_learn';
    perform cron.schedule('veyora_harbour_learn', '*/10 * * * *', 'select public.harbour_learn_all()');
  end if;
end $$;
