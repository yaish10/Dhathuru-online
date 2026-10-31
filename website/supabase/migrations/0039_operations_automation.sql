-- Operations automation, run by the database every minute (pg_cron) — nobody needs the page open:
--   * sailings are generated ahead from active schedule templates (Schedule Settings → Recurring Trip Rules),
--   * captain and crew are assigned from the duty roster (Operations Settings → Auto Crew Rules),
--   * Boarding opens before departure, the trip is marked Departed at its departure time (or Delayed with the reason
--     when it cannot sail: no vessel, vessel out of service, a stopping defect, no captain, not cleared if required),
--     and Arrived at its arrival time (Operations Settings → Departure & Arrival Rules),
--   * passengers: checked-in passengers are Boarded at departure, optional No-show, bookings Completed on arrival.
-- All rules are settings keys, so behaviour can change without SQL. Every automatic change is written to trip_events.

-- 1. Is someone on duty for the whole trip? Their roster shift that day (Shift Definitions times) must cover
--    departure to arrival. No roster entry = not on duty. Shift codes without times count as a full day.
create function roster_covers(p_company uuid, p_user uuid, p_from timestamptz, p_to timestamptz) returns boolean
  language plpgsql stable security definer set search_path = public as
$$ declare tz text; d date; code text; sh jsonb; a int; b int; f int; t int; st jsonb;
begin
  tz := company_tz(p_company);
  d := (p_from at time zone tz)::date;
  select shift into code from roster_entries where company_id = p_company and user_id = p_user and day = d;
  if code is null or not roster_is_working(code) then return false; end if;
  select settings into st from companies where id = p_company;
  sh := roster_shift_json(st, code);
  if sh is null or hm_min(sh->>'start') is null or hm_min(sh->>'end') is null then return true; end if;
  a := hm_min(sh->>'start'); b := hm_min(sh->>'end'); if b <= a then b := b + 1440; end if;
  f := extract(hour from (p_from at time zone tz))::int * 60 + extract(minute from (p_from at time zone tz))::int;
  t := f + greatest(0, ceil(extract(epoch from (p_to - p_from)) / 60.0)::int);
  return f >= a and t <= b;
end $$;
revoke execute on function roster_covers(uuid, uuid, timestamptz, timestamptz) from anon, public;

-- Is a person already on another (open) trip in this window, as captain or crew?
create function person_on_trip(p_company uuid, p_user uuid, p_from timestamptz, p_to timestamptz, p_except uuid) returns boolean
  language sql stable security definer set search_path = public as
$$ select exists (select 1 from trips o where o.company_id = p_company and o.id <> p_except and not trip_closed(o.status)
                    and o.depart_at < p_to and trip_end(o) > p_from
                    and (o.captain_id = p_user or exists (select 1 from trip_crew c where c.trip_id = o.id and c.user_id = p_user))) $$;
revoke execute on function person_on_trip(uuid, uuid, timestamptz, timestamptz, uuid) from anon, public;

-- Best person of a crew group (Captain / Deck / Engineering, from their job title) for a trip: rostered for the whole
-- trip, passes crew_check (status, leave, absence, certificates), free; prefers people assigned to that vessel, then
-- whoever has the fewest trips that day.
create function pick_crew(p_trip uuid, p_group text) returns uuid
  language plpgsql stable security definer set search_path = public as
$$ declare t trips; v vessels; e timestamptz; tz text; d date; u uuid;
begin
  select * into t from trips where id = p_trip;
  select * into v from vessels where id = t.vessel_id;
  e := trip_end(t); tz := company_tz(t.company_id); d := (t.depart_at at time zone tz)::date;
  select cm.user_id into u from company_members cm
    where cm.company_id = t.company_id and cm.active and cm.employment_status = 'Active'
      and member_crew_group(t.company_id, cm.user_id) = p_group
      and cm.user_id is distinct from t.captain_id
      and not exists (select 1 from trip_crew c where c.trip_id = t.id and c.user_id = cm.user_id)
      and roster_covers(t.company_id, cm.user_id, t.depart_at, e)
      and crew_check(t.company_id, cm.user_id, d) is null
      and not person_on_trip(t.company_id, cm.user_id, t.depart_at, e, t.id)
    order by (v.id is not null and lower(coalesce(cm.assigned_vessel, '')) in (lower(v.name), lower(v.code))) desc,
             (select count(*) from trips o where o.company_id = t.company_id and (o.depart_at at time zone tz)::date = d
                and (o.captain_id = cm.user_id or exists (select 1 from trip_crew c where c.trip_id = o.id and c.user_id = cm.user_id))),
             cm.user_id
    limit 1;
  return u;
end $$;
revoke execute on function pick_crew(uuid, text) from anon, public;

-- 2. Fill empty captain / crew places from the roster for trips departing in the next `hours` (default 48).
-- Operations Settings → Auto Crew Rules (3_auto_crew_rules): {enabled (true), hours (48), captain (true), deck (1),
-- engineering (1)}; a vessel can override the numbers with vessels.meta.crew = {"deck": 2, "engineering": 1}.
-- Only empty places are filled; people chosen by hand are never replaced. Returns places filled.
create function auto_assign_crew(p_company uuid) returns integer
  language plpgsql security definer set search_path = public as
$$ declare r jsonb; t record; u uuid; n int := 0; need int; grp text; have int; nm text;
begin
  r := company_setting(p_company, '3_auto_crew_rules');
  if not coalesce((r->>'enabled')::boolean, true) then return 0; end if;
  for t in select tr.id, tr.captain_id, v.meta vmeta from trips tr left join vessels v on v.id = tr.vessel_id
           where tr.company_id = p_company and not trip_closed(tr.status) and tr.status in ('Scheduled', 'Boarding', 'Delayed')
             and (tr.depart_at > now() or (tr.status = 'Delayed' and tr.status_reason like 'Waiting:%' and tr.depart_at > now() - interval '6 hours'))
             and tr.depart_at < now() + make_interval(hours => coalesce(nullif(r->>'hours', '')::int, 48))
           order by tr.depart_at loop
    if t.captain_id is null and coalesce((r->>'captain')::boolean, true) then
      u := pick_crew(t.id, 'Captain');
      if u is not null then
        begin
          update trips set captain_id = u where id = t.id;
          select coalesce(full_name, split_part(email, '@', 1)) into nm from profiles where id = u;
          insert into trip_events (company_id, trip_id, kind, detail) values (p_company, t.id, 'auto', 'Captain ' || coalesce(nm, '') || ' assigned from the roster');
          n := n + 1;
        exception when others then null;
        end;
      end if;
    end if;
    foreach grp in array array['Deck', 'Engineering'] loop
      need := coalesce(nullif(t.vmeta->'crew'->>lower(grp), '')::int, nullif(r->>lower(grp), '')::int, 1);
      select count(*) into have from trip_crew c where c.trip_id = t.id and member_crew_group(p_company, c.user_id) = grp;
      while have < need loop
        u := pick_crew(t.id, grp);
        exit when u is null;
        begin
          insert into trip_crew (trip_id, company_id, user_id, role, meta) values (t.id, p_company, u, grp, '{"auto": true}');
          select coalesce(full_name, split_part(email, '@', 1)) into nm from profiles where id = u;
          insert into trip_events (company_id, trip_id, kind, detail) values (p_company, t.id, 'auto', grp || ' crew ' || coalesce(nm, '') || ' assigned from the roster');
          n := n + 1;
        exception when others then exit;
        end;
        have := have + 1;
      end loop;
    end loop;
  end loop;
  return n;
end $$;
revoke execute on function auto_assign_crew(uuid) from anon, public;

-- Staff can run it for one company now (e.g. after changing the roster).
create function assign_trip_crew(p_company uuid) returns integer
  language plpgsql security definer set search_path = public as
$$ begin
  if not is_company_ops(p_company) then raise exception 'Only Operations can assign crew.'; end if;
  return auto_assign_crew(p_company);
end $$;
revoke execute on function assign_trip_crew(uuid) from anon, public;
grant execute on function assign_trip_crew(uuid) to authenticated;

-- 3. Trips from templates, ahead of time (5_recurring_trip_rules: horizon '30 days', auto true). Same rules as
--    generate_trips; days that clash are skipped quietly.
create function trips_ahead(p_company uuid) returns integer
  language plpgsql security definer set search_path = public as
$$ declare rr jsonb; days int; s schedule_templates; d date; tz text; dep timestamptz; n int := 0;
begin
  rr := company_setting(p_company, '5_recurring_trip_rules');
  if not coalesce((rr->>'auto')::boolean, true) then return 0; end if;
  days := coalesce(nullif(regexp_replace(coalesce(rr->>'horizon', ''), '\D', '', 'g'), '')::int, 30);
  tz := company_tz(p_company);
  for s in select * from schedule_templates where company_id = p_company and active loop
    for d in select g::date from generate_series(greatest((now() at time zone tz)::date, coalesce(s.valid_from, (now() at time zone tz)::date)),
                                                 least((now() at time zone tz)::date + days, coalesce(s.valid_to, (now() at time zone tz)::date + days)), interval '1 day') g loop
      continue when not (extract(isodow from d)::smallint = any(s.weekdays));
      dep := (d + s.depart_time) at time zone tz;
      continue when dep < now() or exists (select 1 from trips where template_id = s.id and depart_at = dep);
      begin
        insert into trips (company_id, route_id, vessel_id, captain_id, template_id, kind, depart_at, arrive_at, seats_total, meta)
          values (s.company_id, s.route_id, s.vessel_id, s.captain_id, s.id, s.kind, dep,
                  case when s.duration_min is not null then dep + make_interval(mins => s.duration_min) end, s.seats, s.meta);
        n := n + 1;
      exception when others then null;
      end;
    end loop;
  end loop;
  return n;
end $$;
revoke execute on function trips_ahead(uuid) from anon, public;

-- 4. Trip status by the clock. Operations Settings → Departure & Arrival Rules (3_departure_and_arrival_rules):
--   autoBoarding (true) + boarding (15): Scheduled → Boarding this many minutes before departure;
--   autoDepart (true): at departure → Departed. If it cannot sail → Delayed with "Waiting: <reason>"; such trips are
--     checked again every minute (for 6 hours) and depart as soon as the reason is fixed.
--     Reasons: no vessel, vessel out of service, a defect that stops operation, no captain (needCaptain, true),
--     not cleared for dispatch (needClearance, false).
--   autoDepart = false: old behaviour, Delayed `late` (15) minutes after departure time.
--   auto (true) + arriveAfter (0): Departed / In transit → Arrived this many minutes after the arrival time.
-- Passengers (7_check_in_rules): at departure Checked in → Boarded (and Booked → No-show when autoNoShow = true);
--   on arrival confirmed bookings → Completed.
create function ops_auto(p_company uuid) returns integer
  language plpgsql security definer set search_path = public as
$$ declare r jsonb; ci jsonb; late int; board int; n int := 0; t record; why text; who uuid[];
begin
  r := company_setting(p_company, '3_departure_and_arrival_rules');
  ci := company_setting(p_company, '7_check_in_rules');
  late := coalesce(nullif(r->>'late', '')::int, 15);
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

  for t in select tr.id, tr.code, tr.status, tr.status_reason, tr.depart_at, tr.vessel_id, tr.captain_id, tr.cleared_at, v.name vname, v.status vstatus
           from trips tr left join vessels v on v.id = tr.vessel_id
           where tr.company_id = p_company and tr.depart_at <= now()
             and ((tr.status in ('Scheduled', 'Boarding') and tr.depart_at > now() - interval '1 day')
               or (tr.status = 'Delayed' and tr.status_reason like 'Waiting:%' and tr.depart_at > now() - interval '6 hours')) loop
    why := null;
    if not coalesce((r->>'autoDepart')::boolean, true) then
      continue when t.status = 'Delayed' or t.depart_at > now() - make_interval(mins => late);
      why := 'Not departed ' || late || ' minutes after departure time';
    else
      why := case
        when t.vessel_id is null then 'Waiting: no vessel assigned'
        when t.vstatus = 'Out of service' then 'Waiting: ' || t.vname || ' is out of service'
        when exists (select 1 from defects d where d.vessel_id = t.vessel_id and d.stops_operation and d.status in ('Open', 'Temporary fix')) then 'Waiting: ' || t.vname || ' has a defect that stops operation'
        when coalesce((r->>'needCaptain')::boolean, true) and t.captain_id is null then 'Waiting: no captain assigned'
        when coalesce((r->>'needClearance')::boolean, false) and t.cleared_at is null then 'Waiting: not cleared for dispatch'
        end;
    end if;
    begin
      if why is null then
        update trips set status = 'Departed', status_reason = null,
          actual_depart = case when t.status = 'Delayed' then now() else t.depart_at end where id = t.id;
        insert into trip_events (company_id, trip_id, kind, detail)
          values (p_company, t.id, 'auto', 'Departed automatically' || case when t.status = 'Delayed' then ' (late)' else ' at departure time' end
                  || case when t.cleared_at is null then ' — not cleared for dispatch' else '' end);
        update booking_passengers set status = 'Boarded', boarded_at = coalesce(boarded_at, now()) where trip_id = t.id and status = 'Checked in';
        if coalesce((ci->>'autoNoShow')::boolean, false) then
          update booking_passengers set status = 'No-show' where trip_id = t.id and status = 'Booked';
        end if;
        n := n + 1;
      elsif t.status <> 'Delayed' or t.status_reason is distinct from why then
        update trips set status = 'Delayed', status_reason = why where id = t.id;
        perform notify_many(p_company, who, 'trip', 'late' || to_char(now(), 'HH24'), 'trip', t.id::text, t.code || ' is delayed', regexp_replace(why, '^Waiting: ', ''));
        n := n + 1;
      end if;
    exception when others then null;
    end;
  end loop;

  if coalesce((r->>'auto')::boolean, true) then
    for t in select x.id from trips x where x.company_id = p_company and x.status in ('Departed', 'In transit')
               and trip_end(x) + make_interval(mins => coalesce(nullif(r->>'arriveAfter', '')::int, 0)) <= now() loop
      begin
        update trips set status = 'Arrived', actual_arrive = coalesce(actual_arrive, arrive_at, now()) where id = t.id;
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

-- The page can still ask for a run (members of the company).
create or replace function scan_operations(p_company uuid) returns integer
  language plpgsql security definer set search_path = public as
$$ begin
  if not is_company_member(p_company) then return 0; end if;
  return ops_auto(p_company);
end $$;

-- Every company with recent, current or coming trips or active templates.
create function ops_tick() returns integer
  language plpgsql security definer set search_path = public as
$$ declare c uuid; n int := 0;
begin
  for c in select id from companies where status = 'Active' and (
             exists (select 1 from trips t where t.company_id = companies.id and t.depart_at > now() - interval '1 day' and t.depart_at < now() + interval '30 days')
             or exists (select 1 from schedule_templates s where s.company_id = companies.id and s.active)) loop
    begin
      n := n + ops_auto(c);
    exception when others then null;
    end;
  end loop;
  return n;
end $$;
revoke execute on function ops_tick() from anon, public, authenticated;

-- 5. Run every minute.
create extension if not exists pg_cron;
select cron.unschedule(jobid) from cron.job where jobname = 'veyora_ops_tick';
select cron.schedule('veyora_ops_tick', '* * * * *', 'select public.ops_tick()');
