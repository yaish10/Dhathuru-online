-- Delays are manual only. Automation may still open boarding, mark Departed / Arrived,
-- and fill crew from the roster — but it must never set status = Delayed.
-- Ops staff mark Delayed themselves with set_trip_status + a reason.

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

  -- Depart at clock time when allowed. If the trip cannot sail, leave it Scheduled/Boarding
  -- (or already Delayed by hand). Never auto-set Delayed.
  if coalesce((r->>'autoDepart')::boolean, true) then
    for t in select tr.id, tr.code, tr.status, tr.status_reason, tr.depart_at, tr.vessel_id, tr.captain_id, tr.cleared_at, v.name vname, v.status vstatus
             from trips tr left join vessels v on v.id = tr.vessel_id
             where tr.company_id = p_company and tr.depart_at <= now()
               and ((tr.status in ('Scheduled', 'Boarding') and tr.depart_at > now() - interval '1 day')
                 or (tr.status = 'Delayed' and tr.depart_at > now() - interval '6 hours')) loop
      why := case
        when t.vessel_id is null then 'no vessel'
        when t.vstatus = 'Out of service' then 'vessel out of service'
        when exists (select 1 from defects d where d.vessel_id = t.vessel_id and d.stops_operation and d.status in ('Open', 'Temporary fix')) then 'stopping defect'
        when coalesce((r->>'needCaptain')::boolean, true) and t.captain_id is null then 'no captain'
        when coalesce((r->>'needClearance')::boolean, false) and t.cleared_at is null then 'not cleared'
        end;
      begin
        if why is null then
          update trips set status = 'Departed', status_reason = null,
            actual_depart = case when t.status = 'Delayed' then now() else t.depart_at end where id = t.id;
          insert into trip_events (company_id, trip_id, kind, detail)
            values (p_company, t.id, 'auto', 'Departed automatically' || case when t.status = 'Delayed' then ' (after manual delay)' else ' at departure time' end
                    || case when t.cleared_at is null then ' — not cleared for dispatch' else '' end);
          update booking_passengers set status = 'Boarded', boarded_at = coalesce(boarded_at, now()) where trip_id = t.id and status = 'Checked in';
          if coalesce((ci->>'autoNoShow')::boolean, false) then
            update booking_passengers set status = 'No-show' where trip_id = t.id and status = 'Booked';
          end if;
          n := n + 1;
        elsif t.status in ('Scheduled', 'Boarding') then
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

-- Keep scan_operations as a thin wrapper (same as 0039); never reintroduce the old late-delay loop.
create or replace function scan_operations(p_company uuid) returns integer
  language plpgsql security definer set search_path = public as
$$ begin
  if not is_company_member(p_company) then return 0; end if;
  return ops_auto(p_company);
end $$;
revoke execute on function scan_operations(uuid) from anon, public;
grant execute on function scan_operations(uuid) to authenticated;
