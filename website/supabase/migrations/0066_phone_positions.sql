-- Phone positions for the vessel a person is checked in to (Operations check-in, 0064), and the live positions list for the
-- Operations map. Fixes go through the same arrival engine as every other source (0058); a phone fix is an estimate of the
-- vessel position and is stored as source 'crew_device'.

-- A person checked in to a vessel shares fixes for that vessel. Nobody else can: no check-in, no vessel, no fixes.
-- p_client_ref = the phone's own id for the fix, so a replayed offline queue is ignored. Speed in metres per second.
create function share_vessel_position(p_company uuid, p_lat float8, p_lng float8, p_observed_at timestamptz,
    p_accuracy_m float8 default null, p_speed_mps float8 default null, p_heading float8 default null,
    p_device text default null, p_client_ref text default null) returns jsonb
  language plpgsql security definer set search_path = public as
$$ declare ck ops_checkins;
begin
  if auth.uid() is null then raise exception 'Sign in first.'; end if;
  if not is_company_member(p_company) then raise exception 'Not a member of this company.'; end if;
  ck := ops_open_checkin(p_company, auth.uid());
  if ck.id is null or ck.vessel_id is null then
    raise exception 'Check in to a vessel in Operations before sharing its position.';
  end if;
  return arrival_ingest(ck.vessel_id, p_lat, p_lng, p_observed_at, p_accuracy_m,
    case when p_speed_mps is not null and p_speed_mps >= 0 then p_speed_mps * 1.943844 end, p_heading,
    'crew_device', left(md5(auth.uid()::text || ':' || coalesce(p_device, '')), 16), left(nullif(btrim(p_client_ref), ''), 64),
    auth.uid(), 'device', null, null);
end $$;
revoke execute on function share_vessel_position(uuid, float8, float8, timestamptz, float8, float8, float8, text, text) from anon, public;
grant execute on function share_vessel_position(uuid, float8, float8, timestamptz, float8, float8, float8, text, text) to authenticated;

-- The newest usable fix per vessel for the Operations map (Operations only; raw fixes stay unreadable).
-- state: Restricted (vessel restricted or out of service), Delayed, Underway (trip departed), At port (everything else).
-- A fix older than p_max_age_min is still listed but marked stale so the map can grey it out.
create function vessel_live_positions(p_company uuid, p_max_age_min int default 360) returns jsonb
  language plpgsql stable security definer set search_path = public as
$$ declare res jsonb; stale_after int := 30;
begin
  if not is_company_ops(p_company) then raise exception 'Only Operations can see live positions.'; end if;
  select coalesce(jsonb_agg(x order by x->>'name'), '[]'::jsonb) into res from (
    select jsonb_build_object(
      'vessel_id', v.id, 'code', v.code, 'name', v.name, 'vessel_status', v.status,
      'lat', p.lat, 'lng', p.lng, 'accuracy_m', p.accuracy_m, 'speed_kn', p.speed_kn, 'heading', p.heading,
      'source', p.source, 'observed_at', coalesce(p.observed_at, p.received_at), 'received_at', p.received_at,
      'age_s', round(extract(epoch from (now() - coalesce(p.observed_at, p.received_at)))),
      'stale', coalesce(p.observed_at, p.received_at) < now() - make_interval(mins => stale_after),
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
        and coalesce(vp.observed_at, vp.received_at) > now() - make_interval(mins => greatest(p_max_age_min, 1))
      order by coalesce(vp.observed_at, vp.received_at) desc limit 1
    ) p on true
    left join lateral (
      select * from trips tt where tt.vessel_id = v.id and tt.status in ('Departed', 'Delayed', 'Boarding')
      order by case tt.status when 'Departed' then 0 when 'Delayed' then 1 else 2 end, tt.depart_at desc limit 1
    ) t on true
    where v.company_id = p_company
  ) q;
  return res;
end $$;
revoke execute on function vessel_live_positions(uuid, int) from anon, public;
grant execute on function vessel_live_positions(uuid, int) to authenticated;
