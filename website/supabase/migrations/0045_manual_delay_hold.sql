-- Follow-up to 0041 (manual delays only) and 0044 (vessel crew mix), 22 Oct 2026.
--  1. ops_auto: a trip delayed by hand is never departed automatically (0041 would depart it a minute later if its
--     time had passed, undoing the delay). Ops press Depart, or move the time with set_trip_status(..., p_new_depart).
--  2. auto_assign_crew: also fills trips held at departure (Scheduled/Boarding past their time, e.g. no captain) and
--     trips delayed by hand, up to 6 hours after departure time. Before 0041 these were auto-"Delayed: Waiting…".
--  3. One-off: trips that the old automation marked "Delayed — Waiting: …" go back to Scheduled (held), since
--     automatic delays no longer exist.

create or replace function ops_auto(p_company uuid) returns integer
  language plpgsql security definer set search_path = public as
$$ declare r jsonb; ci jsonb; board int; n int := 0; t record; why text; who uuid[];
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

  -- Depart at clock time when allowed. If the trip cannot sail, hold it in Scheduled/Boarding.
  -- Never auto-set Delayed, and never auto-depart a trip someone delayed by hand (they press Depart).
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
          -- Hold without delaying: record once per hour so Ops can see why it did not leave.
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

create or replace function auto_assign_crew(p_company uuid) returns integer
  language plpgsql security definer set search_path = public as
$$ declare r jsonb; t record; u uuid; n int := 0; need int; grp text; have int; nm text; mix jsonb; it jsonb; v_role text; v_c record;
begin
  r := company_setting(p_company, '3_auto_crew_rules');
  if not coalesce((r->>'enabled')::boolean, true) then return 0; end if;
  for t in select tr.id, tr.captain_id, tr.vessel_id, tr.status, tr.depart_at, trip_end(tr) as ends, tr.meta tmeta, v.meta vmeta
           from trips tr left join vessels v on v.id = tr.vessel_id
           where tr.company_id = p_company and not trip_closed(tr.status) and tr.status in ('Scheduled', 'Boarding', 'Delayed')
             and (tr.depart_at > now() or tr.depart_at > now() - interval '6 hours')  -- includes trips held at departure or delayed by hand
             and tr.depart_at < now() + make_interval(hours => coalesce(nullif(r->>'hours', '')::int, 48))
           order by tr.depart_at loop

    -- Roster changed? Take off people placed automatically who are no longer on duty (before boarding only).
    if t.status = 'Scheduled' then
      for v_c in select tc.user_id, tc.role from trip_crew tc where tc.trip_id = t.id and (tc.meta->>'auto')::boolean is true
                 and not roster_covers(p_company, tc.user_id, t.depart_at, t.ends) loop
        delete from trip_crew where trip_id = t.id and user_id = v_c.user_id;
        select coalesce(full_name, split_part(email, '@', 1)) into nm from profiles where id = v_c.user_id;
        insert into trip_events (company_id, trip_id, kind, detail) values (p_company, t.id, 'auto', coalesce(nm, '') || ' (' || v_c.role || ') taken off: no longer on duty in the roster');
      end loop;
      if t.captain_id is not null and (t.tmeta->>'auto_captain')::boolean is true and not roster_covers(p_company, t.captain_id, t.depart_at, t.ends) then
        begin
          update trips set captain_id = null, meta = meta - 'auto_captain' where id = t.id;
          select coalesce(full_name, split_part(email, '@', 1)) into nm from profiles where id = t.captain_id;
          insert into trip_events (company_id, trip_id, kind, detail) values (p_company, t.id, 'auto', 'Captain ' || coalesce(nm, '') || ' taken off: no longer on duty in the roster');
          t.captain_id := null;
        exception when others then null;
        end;
      end if;
    end if;

    mix := crew_mix(p_company, t.vessel_id);
    if mix is not null then
      -- Automatic placements under a role this vessel no longer needs (e.g. old "Deck") come off before boarding.
      if t.status = 'Scheduled' then
        delete from trip_crew tc where tc.trip_id = t.id and (tc.meta->>'auto')::boolean is true
          and not exists (select 1 from jsonb_array_elements(mix) m where lower(m->>'role') = lower(tc.role) and coalesce(nullif(m->>'n', '')::int, 0) > 0);
      end if;
      for it in select * from jsonb_array_elements(mix) loop
        v_role := it->>'role'; need := coalesce(nullif(it->>'n', '')::int, 0);
        continue when need <= 0;
        if is_captain_role(v_role) then
          if t.captain_id is null then
            u := pick_crew_role(t.id, v_role);
            if u is not null then
              begin
                update trips set captain_id = u, meta = jsonb_set(meta, '{auto_captain}', 'true') where id = t.id;
                t.captain_id := u;
                select coalesce(full_name, split_part(email, '@', 1)) into nm from profiles where id = u;
                insert into trip_events (company_id, trip_id, kind, detail) values (p_company, t.id, 'auto', 'Captain ' || coalesce(nm, '') || ' assigned from the roster');
                n := n + 1;
              exception when others then null;
              end;
            end if;
          end if;
          have := case when t.captain_id is null then 0 else 1 end;
        else
          have := 0;
        end if;
        have := have + (select count(*) from trip_crew c where c.trip_id = t.id and lower(c.role) = lower(v_role));
        while have < need loop
          u := pick_crew_role(t.id, v_role);
          exit when u is null;
          begin
            insert into trip_crew (trip_id, company_id, user_id, role, meta) values (t.id, p_company, u, v_role, '{"auto": true}');
            select coalesce(full_name, split_part(email, '@', 1)) into nm from profiles where id = u;
            insert into trip_events (company_id, trip_id, kind, detail) values (p_company, t.id, 'auto', v_role || ' ' || coalesce(nm, '') || ' assigned from the roster');
            n := n + 1;
          exception when others then exit;
          end;
          have := have + 1;
        end loop;
      end loop;
      continue;
    end if;

    -- No crew mix: captain + deck + engineering numbers (0039 behaviour).
    if t.captain_id is null and coalesce((r->>'captain')::boolean, true) then
      u := pick_crew(t.id, 'Captain');
      if u is not null then
        begin
          update trips set captain_id = u, meta = jsonb_set(meta, '{auto_captain}', 'true') where id = t.id;
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

do $$ declare t record; begin
  perform set_config('veyora.subscription_write', 'on', true);
  for t in select id, company_id from trips where status = 'Delayed' and status_reason like 'Waiting:%' and depart_at > now() - interval '6 hours' loop  -- older ones stay for Ops to cancel
    begin
      update trips set status = 'Scheduled', status_reason = null where id = t.id;
      insert into trip_events (company_id, trip_id, kind, detail) values (t.company_id, t.id, 'auto', 'Automatic delay removed (delays are now set by hand only)');
    exception when others then null;
    end;
  end loop;
end $$;
