-- Times in messages and notices from trips and maintenance planning are shown in the company's local time
-- (companies.timezone), not UTC. Same logic as 0035 otherwise.

create function local_time(p_company uuid, p_at timestamptz) returns text
  language sql stable security definer set search_path = public as
$$ select to_char(p_at at time zone company_tz(p_company), 'DD Mon HH24:MI') $$;
revoke execute on function local_time(uuid, timestamptz) from anon, public;
grant execute on function local_time(uuid, timestamptz) to authenticated;


create or replace function trips_guard() returns trigger
  language plpgsql security definer set search_path = public as
$$ declare v vessels; r routes; x trips; wo work_orders; e timestamptz;
begin
  new.updated_at := now();
  select * into r from routes where id = new.route_id;
  if r.company_id is distinct from new.company_id then raise exception 'Choose one of your routes.'; end if;
  if new.arrive_at is null and r.duration_min is not null then new.arrive_at := new.depart_at + make_interval(mins => r.duration_min); end if;
  if new.status = 'Departed' and new.actual_depart is null then new.actual_depart := now(); end if;
  if new.status = 'Arrived' and new.actual_arrive is null then new.actual_arrive := now(); end if;
  if new.status in ('Cancelled', 'Arrived') then return new; end if;
  if tg_op = 'UPDATE' and new.status = old.status and new.status in ('Departed')
     and new.vessel_id is not distinct from old.vessel_id and new.depart_at = old.depart_at then return new; end if;
  e := trip_end(new);
  if new.vessel_id is not null then
    select * into v from vessels where id = new.vessel_id;
    if v.company_id is distinct from new.company_id then raise exception 'Choose one of your vessels.'; end if;
    if v.status = 'Out of service' and new.depart_at < now() + interval '24 hours' then
      raise exception '% is out of service%. Choose another vessel or return it to service first.', v.name, coalesce(' (' || v.status_reason || ')', '');
    end if;
    select * into wo from work_orders w where w.vessel_id = new.vessel_id and w.takes_out_of_service and w.status not in ('Completed', 'Closed')
      and w.planned_start < e and coalesce(w.planned_end, w.planned_start) > new.depart_at limit 1;
    if wo.id is not null then
      raise exception '% is booked for maintenance then (% %, % to %).', v.name, wo.code, wo.title, local_time(new.company_id, wo.planned_start), local_time(new.company_id, wo.planned_end);
    end if;
    select * into x from trips t where t.vessel_id = new.vessel_id and t.id <> new.id and t.status not in ('Cancelled', 'Arrived')
      and t.depart_at < e and trip_end(t) > new.depart_at order by t.depart_at limit 1;
    if x.id is not null then
      raise exception '% already has a trip at % (%).', v.name, local_time(new.company_id, x.depart_at), (select name from routes where id = x.route_id);
    end if;
    if new.seats_total is null and v.passenger_capacity is not null then new.seats_total := v.passenger_capacity; end if;
    if v.passenger_capacity is not null and new.seats_total > v.passenger_capacity then
      raise exception '% carries up to % passengers.', v.name, v.passenger_capacity;
    end if;
  end if;
  if new.captain_id is not null then
    if not exists (select 1 from company_members where company_id = new.company_id and user_id = new.captain_id and active and employment_status = 'Active') then
      raise exception 'The captain must be an active member of staff.';
    end if;
    select * into x from trips t where t.id <> new.id and t.status not in ('Cancelled', 'Arrived') and t.depart_at < e and trip_end(t) > new.depart_at
      and (t.captain_id = new.captain_id or exists (select 1 from trip_crew c where c.trip_id = t.id and c.user_id = new.captain_id)) limit 1;
    if x.id is not null then raise exception 'The captain is already on another trip at %.', local_time(new.company_id, x.depart_at); end if;
    if exists (select 1 from leave_requests l where l.company_id = new.company_id and l.user_id = new.captain_id and l.status = 'Approved'
               and l.start_date <= e::date and l.end_date >= new.depart_at::date) then
      raise exception 'The captain is on approved leave then.';
    end if;
  end if;
  return new;
end $$;

create or replace function trip_crew_guard() returns trigger
  language plpgsql security definer set search_path = public as
$$ declare t trips; x trips; e timestamptz;
begin
  select * into t from trips where id = new.trip_id;
  if t.company_id is distinct from new.company_id then raise exception 'Trip not found.'; end if;
  if not exists (select 1 from company_members where company_id = new.company_id and user_id = new.user_id and active and employment_status = 'Active') then
    raise exception 'Crew must be active members of staff.';
  end if;
  e := trip_end(t);
  select * into x from trips o where o.id <> t.id and o.status not in ('Cancelled', 'Arrived') and o.depart_at < e and trip_end(o) > t.depart_at
    and (o.captain_id = new.user_id or exists (select 1 from trip_crew c where c.trip_id = o.id and c.user_id = new.user_id)) limit 1;
  if x.id is not null then raise exception 'That person is already on another trip at %.', local_time(new.company_id, x.depart_at); end if;
  if exists (select 1 from leave_requests l where l.company_id = new.company_id and l.user_id = new.user_id and l.status = 'Approved'
             and l.start_date <= e::date and l.end_date >= t.depart_at::date) then
    raise exception 'That person is on approved leave then.';
  end if;
  return new;
end $$;

create or replace function set_trip_status(p_id uuid, p_status text, p_reason text default null, p_new_depart timestamptz default null) returns trips
  language plpgsql security definer set search_path = public as
$$ declare t trips; who uuid[];
begin
  select * into t from trips where id = p_id;
  if not found then raise exception 'Trip not found.'; end if;
  if not (is_company_ops(t.company_id) or t.captain_id = auth.uid()) then raise exception 'Only Operations or the captain can change this trip.'; end if;
  if p_status not in ('Scheduled', 'Boarding', 'Departed', 'Arrived', 'Delayed', 'Cancelled') then raise exception 'Unknown trip status.'; end if;
  if p_status in ('Delayed', 'Cancelled') and coalesce(btrim(p_reason), '') = '' then raise exception 'Say why the trip is %.', lower(p_status); end if;
  update trips set status = p_status, status_reason = coalesce(nullif(btrim(p_reason), ''), case when p_status in ('Scheduled', 'Boarding', 'Departed', 'Arrived') then null else status_reason end),
    depart_at = coalesce(p_new_depart, depart_at),
    arrive_at = case when p_new_depart is not null and arrive_at is not null then arrive_at + (p_new_depart - depart_at) else arrive_at end
    where id = p_id returning * into t;
  if p_status in ('Delayed', 'Cancelled') then
    select array_agg(distinct u) into who from (select unnest(ops_user_ids(t.company_id)) u union select t.captain_id union select user_id from trip_crew where trip_id = t.id) z where u is not null;
    perform notify_many(t.company_id, who, 'trip', lower(left(p_status, 5)) || to_char(now(), 'HH24MI'), 'trip', t.id::text,
      (select name from routes where id = t.route_id) || ' ' || local_time(t.company_id, t.depart_at) || ' ' || lower(p_status), coalesce(p_reason, ''));
  end if;
  return t;
end $$;

create or replace function plan_work_order(p_id uuid, p_start timestamptz, p_end timestamptz, p_out boolean default false, p_downtime numeric default null) returns work_orders
  language plpgsql security definer set search_path = public as
$$ declare w work_orders; v vessels; clash work_orders; was timestamptz; tech_clash work_orders; tr trips; ntr int;
begin
  select * into w from work_orders where id = p_id;
  if not found then raise exception 'Work order not found.'; end if;
  if not is_company_maint(w.company_id) then raise exception 'Only maintenance staff can plan jobs.'; end if;
  if w.status in ('Completed', 'Closed') then raise exception 'This job is already %.', lower(w.status); end if;
  if p_start is null then
    update work_orders set planned_start = null, planned_end = null, takes_out_of_service = false, est_downtime_hours = null where id = p_id returning * into w;
    return w;
  end if;
  if p_end is null or p_end <= p_start then raise exception 'The end must be after the start.'; end if;
  select * into v from vessels where id = w.vessel_id;
  if coalesce(p_out, false) then
    select * into clash from work_orders x where x.vessel_id = w.vessel_id and x.id <> w.id and x.takes_out_of_service and x.status not in ('Completed', 'Closed')
      and x.planned_start < p_end and coalesce(x.planned_end, x.planned_start) > p_start order by x.planned_start limit 1;
    if clash.id is not null then
      raise exception '% is already booked out of service for % (% to %).', v.name, clash.code, local_time(w.company_id, clash.planned_start), local_time(w.company_id, clash.planned_end);
    end if;
    select count(*) into ntr from trips t where t.vessel_id = w.vessel_id and t.status not in ('Cancelled', 'Arrived') and t.depart_at < p_end and trip_end(t) > p_start;
    if ntr > 0 then
      select * into tr from trips t where t.vessel_id = w.vessel_id and t.status not in ('Cancelled', 'Arrived') and t.depart_at < p_end and trip_end(t) > p_start order by t.depart_at limit 1;
      raise exception '% has % trip(s) booked then (first: % %). Ask Operations to move them or use another vessel.', v.name, ntr,
        (select name from routes where id = tr.route_id), local_time(w.company_id, tr.depart_at);
    end if;
  end if;
  if w.assignee is not null then
    select * into tech_clash from work_orders x where x.assignee = w.assignee and x.id <> w.id and x.status not in ('Completed', 'Closed')
      and x.planned_start < p_end and coalesce(x.planned_end, x.planned_start) > p_start limit 1;
    if tech_clash.id is not null then
      raise exception 'The person assigned already has % planned at that time.', tech_clash.code;
    end if;
  end if;
  was := w.planned_start;
  update work_orders set planned_start = p_start, planned_end = p_end, takes_out_of_service = coalesce(p_out, false),
    est_downtime_hours = coalesce(p_downtime, case when coalesce(p_out, false) then round(extract(epoch from (p_end - p_start)) / 3600.0, 1) end)
    where id = p_id returning * into w;
  perform maint_log(w.company_id, w.vessel_id, 'plan', w.id, w.code || case when was is null then ' planned ' else ' moved to ' end || local_time(w.company_id, p_start) || '–' || local_time(w.company_id, p_end)
    || case when w.takes_out_of_service then ' (vessel out of service)' else '' end);
  if w.takes_out_of_service then
    perform notify_many(w.company_id, maint_user_ids(w.company_id), 'maint_plan', to_char(now(), 'YYYYMMDDHH24MI'), 'work_order', w.id::text,
      v.name || case when was is null then ' booked out of service' else ' maintenance moved' end,
      local_time(w.company_id, p_start) || ' to ' || local_time(w.company_id, p_end) || ' · ' || w.code || ' ' || w.title);
  end if;
  if w.assignee is not null then
    perform notify_user(w.company_id, w.assignee, 'work_order', 'plan' || to_char(now(), 'HH24MI'), 'work_order', w.id::text,
      w.code || ' planned for ' || local_time(w.company_id, p_start), w.title);
  end if;
  return w;
end $$;
