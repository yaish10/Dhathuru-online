-- Land / sea check for vessel positions. A phone that is on an island (not on the water) cannot be the vessel, so such a fix is
-- stored but marked on_land, never broadcast, and the Operations map keeps showing the vessel at its last position at sea.
--   land_masses   island outlines (reference data, loaded from supabase/seed/maldives_land_masses_*.sql, OpenStreetMap coastline,
--                 © OpenStreetMap contributors, ODbL). Outside the loaded area every fix counts as sea.
--   fix_on_land() true when the point is inside an island by more than 15 m (GPS error margin) and not inside one of the
--                 company's active harbour zones (a boat tied up at a jetty is at the port, not "on land").
--   Company setting 3_vessel_map { holdOnLand: boolean } turns the rule off (default on).
-- Uses the project's own geo_polygon_eval (0058); no PostGIS.

create table land_masses (
  id      serial primary key,
  min_lat float8 not null, max_lat float8 not null, min_lng float8 not null, max_lng float8 not null,
  ring    jsonb not null check (jsonb_typeof(ring) = 'array')       -- [[lat, lng], ...]
);
create index land_masses_box on land_masses (min_lat, max_lat);
alter table land_masses enable row level security;   -- no policies: only the security-definer functions below read it

create function fix_on_land(p_company uuid, p_lat float8, p_lng float8, p_margin_m float8 default 15) returns boolean
  language plpgsql stable security definer set search_path = public as
$$ declare h record; l record; ev jsonb; pad constant float8 := 0.0003;
begin
  if p_lat is null or p_lng is null then return false; end if;
  for h in select lat, lng, geofence_type, radius_m, polygon from harbours where company_id = p_company and active loop
    if h.geofence_type = 'polygon' and jsonb_typeof(h.polygon) = 'array' then
      if (geo_polygon_eval(h.polygon, p_lat, p_lng)->>'inside')::boolean then return false; end if;
    elsif geo_distance_m(h.lat, h.lng, p_lat, p_lng) <= h.radius_m then return false;
    end if;
  end loop;
  for l in select ring from land_masses
           where min_lat <= p_lat + pad and max_lat >= p_lat - pad and min_lng <= p_lng + pad and max_lng >= p_lng - pad loop
    ev := geo_polygon_eval(l.ring, p_lat, p_lng);
    if (ev->>'inside')::boolean and coalesce((ev->>'edge_m')::float8, 0) >= p_margin_m then return true; end if;
  end loop;
  return false;
end $$;
revoke execute on function fix_on_land(uuid, float8, float8, float8) from anon, public, authenticated;

alter table vessel_positions add column on_land boolean not null default false;

create or replace function vpos_mark_land() returns trigger
  language plpgsql security definer set search_path = public as
$$ begin
  begin new.on_land := fix_on_land(new.company_id, new.lat, new.lng);
  exception when others then new.on_land := false; end;
  return new;
end $$;
revoke execute on function vpos_mark_land() from anon, public, authenticated;
drop trigger if exists vpos_land on vessel_positions;
create trigger vpos_land before insert on vessel_positions for each row execute function vpos_mark_land();

-- A fix on land is not broadcast to the live map (0074 keeps working; this replaces its function).
create or replace function broadcast_vessel_position() returns trigger
  language plpgsql security definer set search_path = public as
$$ begin
  if new.lat is null or new.lng is null or new.on_land then return new; end if;
  begin
    perform realtime.send(jsonb_build_object('vessel_id', new.vessel_id, 'lat', new.lat, 'lng', new.lng, 'heading', new.heading,
        'speed_kn', new.speed_kn, 'accuracy_m', new.accuracy_m, 'source', new.source, 'at', coalesce(new.observed_at, new.received_at)),
      'position', 'vessel-pos:' || new.company_id::text, true);
  exception when others then null;
  end;
  return new;
end $$;

-- The Operations map list: the newest fix that is not on land. 'held' = the newest fix of all is on land, so the vessel is
-- shown where it was last at sea ('live_age_s' = age of that newer, on-land fix). A vessel with no fix at sea in the window is
-- not listed. holdOnLand = false in setting 3_vessel_map shows every fix as before.
create or replace function vessel_live_positions(p_company uuid, p_max_age_min int default 360) returns jsonb
  language plpgsql stable security definer set search_path = public as
$$ declare res jsonb; stale_after int := 30; hold boolean;
begin
  if not is_company_ops(p_company) then raise exception 'Only Operations can see live positions.'; end if;
  select coalesce((settings->'3_vessel_map'->>'holdOnLand')::boolean, true) into hold from companies where id = p_company;
  select coalesce(jsonb_agg(x order by x->>'name'), '[]'::jsonb) into res from (
    select jsonb_build_object(
      'vessel_id', v.id, 'code', v.code, 'name', v.name, 'vessel_status', v.status,
      'lat', p.lat, 'lng', p.lng, 'accuracy_m', p.accuracy_m, 'speed_kn', p.speed_kn, 'heading', p.heading,
      'source', p.source, 'observed_at', coalesce(p.observed_at, p.received_at), 'received_at', p.received_at,
      'age_s', round(extract(epoch from (now() - coalesce(p.observed_at, p.received_at)))),
      'stale', coalesce(p.observed_at, p.received_at) < now() - make_interval(mins => stale_after),
      'held', coalesce(hold and n.on_land and coalesce(n.observed_at, n.received_at) > coalesce(p.observed_at, p.received_at), false),
      'live_age_s', round(extract(epoch from (now() - coalesce(n.observed_at, n.received_at)))),
      'trip', case when t.id is null then null else jsonb_build_object('id', t.id, 'code', t.code, 'status', t.status) end,
      'state', case
        when v.status in ('Restricted', 'Out of service') then 'Restricted'
        when t.status = 'Delayed' then 'Delayed'
        when t.status = 'Departed' then 'Underway'
        else 'At port' end) as x
    from vessels v
    join lateral (
      select * from vessel_positions vp
      where vp.vessel_id = v.id and vp.lat is not null and vp.lng is not null
        and vp.validity in ('valid', 'no_active_trip', 'trip_not_under_way', 'after_arrival', 'detection_off', 'no_destination_harbour')
        and (not hold or not vp.on_land)
        and coalesce(vp.observed_at, vp.received_at) > now() - make_interval(mins => greatest(p_max_age_min, 1))
      order by coalesce(vp.observed_at, vp.received_at) desc limit 1
    ) p on true
    left join lateral (
      select * from vessel_positions vq
      where vq.vessel_id = v.id and vq.lat is not null and vq.lng is not null
        and vq.validity in ('valid', 'no_active_trip', 'trip_not_under_way', 'after_arrival', 'detection_off', 'no_destination_harbour')
      order by coalesce(vq.observed_at, vq.received_at) desc limit 1
    ) n on true
    left join lateral (
      select * from trips tt where tt.vessel_id = v.id and tt.status in ('Departed', 'Delayed', 'Boarding')
      order by case tt.status when 'Departed' then 0 when 'Delayed' then 1 else 2 end, tt.depart_at desc limit 1
    ) t on true
    where v.company_id = p_company
  ) q;
  return res;
end $$;
