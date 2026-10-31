-- Operations dispatch board (operations.html, Cursor 21 Oct 2026): trip numbers, dispatch clearance with the
-- Operations Settings rules, a dispatch queue, incidents & advisories, auto-delay / auto-arrive, trip history,
-- and one call that feeds the board. Trip statuses are now taken from Operations Settings → Trip Statuses.
--
-- Extends without new SQL: new tables have `meta jsonb`; kinds/categories/priorities are free text (lists live in
-- 3_ settings); rules are read from 3_dispatch_rules, 3_departure_and_arrival_rules, 3_trip_cancellation_rules,
-- 3_trip_number_format. Only "closed" statuses (Cancelled, Arrived, Completed) have a fixed meaning.

-- 1. Trip statuses: any name from Trip Statuses (2–30 chars). Cancelled / Arrived / Completed mean the trip is closed.
alter table trips drop constraint if exists trips_status_check;
alter table trips add constraint trips_status_check check (char_length(btrim(status)) between 2 and 30);

create function trip_closed(p_status text) returns boolean
  language sql immutable as $$ select p_status in ('Cancelled', 'Arrived', 'Completed') $$;

-- A company's 3_ (Operations) setting object, or {} when not saved yet.
create function ops_setting(p_company uuid, p_key text) returns jsonb
  language sql stable security definer set search_path = public as
$$ select coalesce((select settings->p_key from companies where id = p_company), '{}'::jsonb) $$;
revoke execute on function ops_setting(uuid, text) from anon, public;

-- 2. Trip numbers (Operations Settings → Trip Number Format, e.g. TR-2026-000001), clearance and history columns.
alter table trips
  add column number     integer,
  add column code       text,
  add column cleared_at timestamptz,
  add column cleared_by uuid references auth.users(id) on delete set null,
  add column clearance  jsonb not null default '{}'::jsonb;
create unique index trips_number_key on trips (company_id, number);

create function trip_code(p_company uuid, p_n int) returns text
  language sql stable security definer set search_path = public as
$$ select coalesce(nullif(f->>'prefix', ''), 'TR')
       || case when coalesce(f->>'sep', '-') = 'none' then '' else coalesce(f->>'sep', '-') end
       || case when coalesce((f->>'year')::boolean, true) then to_char(current_date, 'YYYY') || case when coalesce(f->>'sep', '-') = 'none' then '' else coalesce(f->>'sep', '-') end else '' end
       || lpad(p_n::text, greatest(1, least(10, coalesce(nullif(f->>'digits', '')::int, 6))), '0')
   from (select ops_setting(p_company, '3_trip_number_format') f) x $$;

create function trips_number() returns trigger
  language plpgsql security definer set search_path = public as
$$ begin
  if new.number is null then
    perform pg_advisory_xact_lock(hashtext('trip_' || new.company_id::text));
    select greatest(coalesce(max(number), 0) + 1, coalesce(nullif(ops_setting(new.company_id, '3_trip_number_format')->>'start', '')::int, 1))
      into new.number from trips where company_id = new.company_id;
  end if;
  if new.code is null then new.code := trip_code(new.company_id, new.number); end if;
  return new;
end $$;
create trigger trp_number before insert on trips for each row execute function trips_number();

-- Trip history (status changes, clearance, edits). Members read; written by triggers and RPCs only.
create table trip_events (
  id         bigint generated always as identity primary key,
  company_id uuid not null references companies(id) on delete cascade,
  trip_id    uuid not null references trips(id) on delete cascade,
  kind       text not null,
  detail     text check (detail is null or char_length(detail) <= 300),
  actor      uuid references auth.users(id) on delete set null,
  meta       jsonb not null default '{}'::jsonb,
  created_at timestamptz not null default now()
);
create index on trip_events (trip_id, created_at);
alter table trip_events enable row level security;
create policy tev_select on trip_events for select to authenticated using (is_company_member(company_id));

create function trips_history() returns trigger
  language plpgsql security definer set search_path = public as
$$ begin
  if tg_op = 'INSERT' then
    insert into trip_events (company_id, trip_id, kind, detail, actor) values (new.company_id, new.id, 'created', new.code || ' created', auth.uid());
  else
    if new.status is distinct from old.status then
      insert into trip_events (company_id, trip_id, kind, detail, actor)
        values (new.company_id, new.id, 'status', old.status || ' → ' || new.status || coalesce(': ' || new.status_reason, ''), auth.uid());
    end if;
    if new.depart_at <> old.depart_at then
      insert into trip_events (company_id, trip_id, kind, detail, actor)
        values (new.company_id, new.id, 'moved', 'Departure ' || local_time(new.company_id, old.depart_at) || ' → ' || local_time(new.company_id, new.depart_at), auth.uid());
    end if;
    if new.vessel_id is distinct from old.vessel_id or new.captain_id is distinct from old.captain_id then
      insert into trip_events (company_id, trip_id, kind, detail, actor)
        values (new.company_id, new.id, 'assigned', 'Vessel or captain changed', auth.uid());
    end if;
    if new.cleared_at is not null and old.cleared_at is null then
      insert into trip_events (company_id, trip_id, kind, detail, actor, meta) values (new.company_id, new.id, 'cleared', 'Cleared for dispatch', auth.uid(), new.clearance);
    end if;
  end if;
  return null;
end $$;
create trigger trp_history after insert or update on trips for each row execute function trips_history();

-- 3. Dispatch queue: tasks that need a decision before departure. priority is free text (UI: High / Due / Review).
create table dispatch_tasks (
  id         uuid primary key default gen_random_uuid(),
  company_id uuid not null references companies(id) on delete cascade,
  trip_id    uuid references trips(id) on delete cascade,
  title      text not null check (char_length(btrim(title)) between 2 and 120),
  detail     text check (detail is null or char_length(detail) <= 1000),
  priority   text not null default 'Review' check (char_length(btrim(priority)) between 2 and 20),
  blocks_dispatch boolean not null default false,
  status     text not null default 'Open' check (status in ('Open', 'Done', 'Dismissed')),
  assignee   uuid references auth.users(id) on delete set null,
  due_at     timestamptz,
  done_at    timestamptz,
  done_by    uuid references auth.users(id) on delete set null,
  done_note  text check (done_note is null or char_length(done_note) <= 300),
  meta       jsonb not null default '{}'::jsonb check (jsonb_typeof(meta) = 'object' and pg_column_size(meta) <= 16384),
  created_by uuid references auth.users(id) on delete set null,
  created_at timestamptz not null default now()
);
create index on dispatch_tasks (company_id, status);
alter table dispatch_tasks enable row level security;
create policy dtk_select on dispatch_tasks for select to authenticated using (is_company_member(company_id));
create policy dtk_insert on dispatch_tasks for insert to authenticated with check (is_company_ops(company_id));
create policy dtk_update on dispatch_tasks for update to authenticated using (is_company_ops(company_id)) with check (is_company_ops(company_id));
create policy dtk_delete on dispatch_tasks for delete to authenticated using (is_company_ops(company_id));
create trigger dtk_subscription before insert or update or delete on dispatch_tasks for each row execute function reject_if_subscription_expired();

-- Finish a task: Operations or the person it is assigned to.
create function finish_dispatch_task(p_id uuid, p_done boolean default true, p_note text default null) returns dispatch_tasks
  language plpgsql security definer set search_path = public as
$$ declare k dispatch_tasks;
begin
  select * into k from dispatch_tasks where id = p_id;
  if not found then raise exception 'Task not found.'; end if;
  if not (is_company_ops(k.company_id) or k.assignee = auth.uid()) then raise exception 'Only Operations or the person assigned can finish this task.'; end if;
  update dispatch_tasks set status = case when p_done then 'Done' else 'Dismissed' end, done_at = now(), done_by = auth.uid(), done_note = nullif(btrim(p_note), '')
    where id = p_id returning * into k;
  if k.trip_id is not null then
    insert into trip_events (company_id, trip_id, kind, detail, actor) values (k.company_id, k.trip_id, 'task', k.title || ': ' || k.status, auth.uid());
  end if;
  return k;
end $$;
revoke execute on function finish_dispatch_task(uuid, boolean, text) from anon, public;
grant execute on function finish_dispatch_task(uuid, boolean, text) to authenticated;

-- 4. Incidents & advisories (weather, delays, pier notices, incidents). kind is free text (Incident Categories etc.).
create table ops_advisories (
  id          uuid primary key default gen_random_uuid(),
  company_id  uuid not null references companies(id) on delete cascade,
  kind        text not null default 'Advisory' check (char_length(btrim(kind)) between 2 and 40),
  severity    text not null default 'Warning' check (severity in ('Info', 'Warning', 'Critical')),
  title       text not null check (char_length(btrim(title)) between 2 and 120),
  detail      text check (detail is null or char_length(detail) <= 2000),
  route_id    uuid references routes(id) on delete set null,
  vessel_id   uuid references vessels(id) on delete set null,
  trip_id     uuid references trips(id) on delete set null,
  blocks_dispatch boolean not null default false,
  starts_at   timestamptz not null default now(),
  ends_at     timestamptz,
  resolved_at timestamptz,
  resolved_by uuid references auth.users(id) on delete set null,
  meta        jsonb not null default '{}'::jsonb check (jsonb_typeof(meta) = 'object' and pg_column_size(meta) <= 16384),
  created_by  uuid references auth.users(id) on delete set null,
  created_at  timestamptz not null default now(),
  check (ends_at is null or ends_at > starts_at)
);
create index on ops_advisories (company_id, starts_at desc);
alter table ops_advisories enable row level security;
create policy adv_select on ops_advisories for select to authenticated using (is_company_member(company_id));
create policy adv_insert on ops_advisories for insert to authenticated with check (is_company_ops(company_id));
create policy adv_update on ops_advisories for update to authenticated using (is_company_ops(company_id)) with check (is_company_ops(company_id));
create policy adv_delete on ops_advisories for delete to authenticated using (is_company_ops(company_id));
create trigger adv_subscription before insert or update or delete on ops_advisories for each row execute function reject_if_subscription_expired();

-- In force now: started, not ended, not resolved.
create function advisory_active(a ops_advisories) returns boolean
  language sql stable as $$ select a.resolved_at is null and a.starts_at <= now() and (a.ends_at is null or a.ends_at > now()) $$;

-- Staff can report an incident (any member); Operations is told. Warnings/critical advisories notify Operations and the
-- captain and crew of the linked trip.
create function report_incident(p_company uuid, p_row jsonb) returns ops_advisories
  language plpgsql security definer set search_path = public as
$$ declare a ops_advisories;
begin
  if not is_company_member(p_company) then raise exception 'Not a member of this company.'; end if;
  if coalesce(char_length(btrim(p_row->>'title')), 0) < 2 then raise exception 'Say what happened.'; end if;
  insert into ops_advisories (company_id, kind, severity, title, detail, route_id, vessel_id, trip_id, blocks_dispatch, meta, created_by)
    values (p_company, coalesce(nullif(btrim(p_row->>'kind'), ''), 'Incident'), coalesce(nullif(p_row->>'severity', ''), 'Warning'), btrim(p_row->>'title'),
            nullif(btrim(p_row->>'detail'), ''), nullif(p_row->>'route_id', '')::uuid, nullif(p_row->>'vessel_id', '')::uuid, nullif(p_row->>'trip_id', '')::uuid,
            coalesce((p_row->>'blocks_dispatch')::boolean, false) and is_company_ops(p_company),
            case when jsonb_typeof(p_row->'meta') = 'object' then p_row->'meta' else '{}'::jsonb end, auth.uid())
    returning * into a;
  return a;
end $$;
revoke execute on function report_incident(uuid, jsonb) from anon, public;
grant execute on function report_incident(uuid, jsonb) to authenticated;

create function advisories_notify() returns trigger
  language plpgsql security definer set search_path = public as
$$ declare who uuid[];
begin
  if new.severity = 'Info' then return null; end if;
  select array_agg(distinct u) into who from (
    select unnest(ops_user_ids(new.company_id)) u
    union select t.captain_id from trips t where t.id = new.trip_id
    union select c.user_id from trip_crew c where c.trip_id = new.trip_id) z where u is not null;
  perform notify_many(new.company_id, who, 'ops_advisory', 'new', 'advisory', new.id::text,
    left(new.kind || ': ' || new.title, 120), coalesce(new.detail, ''));
  return null;
end $$;
create trigger adv_notify after insert on ops_advisories for each row execute function advisories_notify();

-- 5. Dispatch clearance. Rules from Operations Settings → Dispatch Rules (3_dispatch_rules):
--   crew (default on): a captain is assigned;  checklist (default on): a checklist was submitted for the vessel today
--   with nothing failed, or p_checks.checklist = true;  weather (default on): p_checks.weather = true;
--   lead (default 60): clearance opens this many minutes before departure.
-- Always: vessel not out of service, no open defect that stops operation, no open task that blocks dispatch,
-- no active advisory that blocks dispatch for this trip, route or vessel.
-- Returns the trip; when something is missing it raises one message listing everything still to do.
create function clear_trip(p_id uuid, p_checks jsonb default '{}'::jsonb, p_note text default null) returns trips
  language plpgsql security definer set search_path = public as
$$ declare t trips; v vessels; rules jsonb; miss text[] := '{}'; lead int; tz text;
begin
  select * into t from trips where id = p_id;
  if not found then raise exception 'Trip not found.'; end if;
  if not is_company_ops(t.company_id) then raise exception 'Only Operations can clear trips for dispatch.'; end if;
  if trip_closed(t.status) then raise exception 'This trip is %.', lower(t.status); end if;
  rules := ops_setting(t.company_id, '3_dispatch_rules');
  lead := coalesce(nullif(rules->>'lead', '')::int, 60);
  tz := company_tz(t.company_id);
  if t.depart_at > now() + make_interval(mins => lead) then
    miss := miss || ('Clearance opens ' || lead || ' minutes before departure (' || local_time(t.company_id, t.depart_at - make_interval(mins => lead)) || ')');
  end if;
  if t.vessel_id is null then miss := miss || 'Assign a vessel'::text;
  else
    select * into v from vessels where id = t.vessel_id;
    if v.status = 'Out of service' then miss := miss || (v.name || ' is out of service'); end if;
    if exists (select 1 from defects d where d.vessel_id = v.id and d.stops_operation and d.status in ('Open', 'Temporary fix')) then
      miss := miss || (v.name || ' has an open defect that stops operation');
    end if;
    if coalesce((rules->>'checklist')::boolean, true) and not coalesce((p_checks->>'checklist')::boolean, false)
       and not exists (select 1 from maint_inspections i where i.vessel_id = v.id and i.failed = 0
                         and (i.submitted_at at time zone tz)::date = (t.depart_at at time zone tz)::date) then
      miss := miss || 'Safety checklist for the vessel today'::text;
    end if;
  end if;
  if coalesce((rules->>'crew')::boolean, true) and t.captain_id is null then miss := miss || 'Assign a captain'::text; end if;
  if coalesce((rules->>'weather')::boolean, true) and not coalesce((p_checks->>'weather')::boolean, false) then miss := miss || 'Confirm the weather check'::text; end if;
  if exists (select 1 from dispatch_tasks k where k.trip_id = t.id and k.status = 'Open' and k.blocks_dispatch) then
    miss := miss || 'Finish the open dispatch tasks'::text;
  end if;
  if exists (select 1 from ops_advisories a where a.company_id = t.company_id and a.blocks_dispatch and advisory_active(a)
               and (a.trip_id = t.id or a.route_id = t.route_id or a.vessel_id = t.vessel_id or (a.trip_id is null and a.route_id is null and a.vessel_id is null))) then
    miss := miss || 'An advisory is stopping departures'::text;
  end if;
  if cardinality(miss) > 0 then raise exception 'Not ready to dispatch: %.', array_to_string(miss, '; '); end if;
  update trips set cleared_at = now(), cleared_by = auth.uid(),
    clearance = coalesce(p_checks, '{}'::jsonb) || jsonb_build_object('note', nullif(btrim(p_note), ''), 'rules', rules)
    where id = p_id returning * into t;
  return t;
end $$;
revoke execute on function clear_trip(uuid, jsonb, text) from anon, public;
grant execute on function clear_trip(uuid, jsonb, text) to authenticated;

-- 6. Status changes. Any status from Trip Statuses is allowed. Boarding/Departed/In transit need a clearance unless
-- 3_dispatch_rules.enforce = false. Delayed needs a reason; Cancelled needs one unless Trip Cancellation Rules says
-- reason = false. Delays and cancellations notify the captain, crew and Operations.
create or replace function set_trip_status(p_id uuid, p_status text, p_reason text default null, p_new_depart timestamptz default null) returns trips
  language plpgsql security definer set search_path = public as
$$ declare t trips; who uuid[]; allowed text[]; st jsonb;
begin
  select * into t from trips where id = p_id;
  if not found then raise exception 'Trip not found.'; end if;
  if not (is_company_ops(t.company_id) or t.captain_id = auth.uid()) then raise exception 'Only Operations or the captain can change this trip.'; end if;
  p_status := btrim(coalesce(p_status, ''));
  st := (select settings->'3_trip_statuses' from companies where id = t.company_id);
  allowed := array['Scheduled', 'Boarding', 'Departed', 'In transit', 'Arrived', 'Delayed', 'Cancelled', 'Completed']
    || coalesce((select array_agg(coalesce(e->>'name', e#>>'{}')) from jsonb_array_elements(case when jsonb_typeof(st) = 'array' then st else '[]'::jsonb end) e), '{}');
  if not (p_status = any(allowed)) then raise exception 'Unknown trip status "%". Add it under Operations Settings → Trip Statuses.', p_status; end if;
  if p_status = 'Delayed' and coalesce(btrim(p_reason), '') = '' then raise exception 'Say why the trip is delayed.'; end if;
  if p_status = 'Cancelled' and coalesce(btrim(p_reason), '') = '' and coalesce((ops_setting(t.company_id, '3_trip_cancellation_rules')->>'reason')::boolean, true) then
    raise exception 'Say why the trip is cancelled.';
  end if;
  if p_status in ('Boarding', 'Departed', 'In transit') and t.cleared_at is null and p_new_depart is null
     and coalesce((ops_setting(t.company_id, '3_dispatch_rules')->>'enforce')::boolean, true) then
    raise exception 'Clear this trip for dispatch first.';
  end if;
  update trips set status = p_status,
    status_reason = case when p_status in ('Delayed', 'Cancelled') or nullif(btrim(p_reason), '') is not null then nullif(btrim(p_reason), '') end,
    depart_at = coalesce(p_new_depart, depart_at),
    arrive_at = case when p_new_depart is not null and arrive_at is not null then arrive_at + (p_new_depart - depart_at) else arrive_at end
    where id = p_id returning * into t;
  if p_status in ('Delayed', 'Cancelled') then
    select array_agg(distinct u) into who from (select unnest(ops_user_ids(t.company_id)) u union select t.captain_id union select user_id from trip_crew where trip_id = t.id) z where u is not null;
    perform notify_many(t.company_id, who, 'trip', lower(left(p_status, 5)) || to_char(now(), 'HH24MI'), 'trip', t.id::text,
      t.code || ' ' || (select name from routes where id = t.route_id) || ' ' || local_time(t.company_id, t.depart_at) || ' ' || lower(p_status), coalesce(p_reason, ''));
  end if;
  return t;
end $$;

-- 7. Timing rules (Operations Settings → Departure & Arrival Rules): a trip not departed `late` minutes (default 15)
-- after its time is marked Delayed; with auto (default on) a departed trip is marked Arrived `arrival` minutes
-- (default 30) after its arrival time. Call when the Operations page loads. Returns the number of trips changed.
create function scan_operations(p_company uuid) returns integer
  language plpgsql security definer set search_path = public as
$$ declare r jsonb; late int; arr int; n int := 0; t record; who uuid[];
begin
  if not is_company_member(p_company) then return 0; end if;
  r := ops_setting(p_company, '3_departure_and_arrival_rules');
  late := coalesce(nullif(r->>'late', '')::int, 15);
  arr := coalesce(nullif(r->>'arrival', '')::int, 30);
  who := ops_user_ids(p_company);
  for t in select id, code, depart_at from trips where company_id = p_company and status in ('Scheduled', 'Boarding')
             and depart_at < now() - make_interval(mins => late) and depart_at > now() - interval '2 days' loop
    update trips set status = 'Delayed', status_reason = 'Not departed ' || late || ' minutes after departure time' where id = t.id;
    perform notify_many(p_company, who, 'trip', 'late', 'trip', t.id::text, t.code || ' has not departed', 'Due ' || local_time(p_company, t.depart_at));
    n := n + 1;
  end loop;
  if coalesce((r->>'auto')::boolean, true) then
    update trips set status = 'Arrived', actual_arrive = coalesce(actual_arrive, arrive_at)
      where company_id = p_company and status in ('Departed', 'In transit') and arrive_at is not null and arrive_at < now() - make_interval(mins => arr);
    get diagnostics late = row_count;
    n := n + late;
  end if;
  return n;
end $$;
revoke execute on function scan_operations(uuid) from anon, public;
grant execute on function scan_operations(uuid) to authenticated;

-- Clash checks and maintenance planning (same as 0036) now treat Completed like Arrived and clear dispatch on edits.
create or replace function trips_guard() returns trigger
  language plpgsql security definer set search_path = public as
$$ declare v vessels; r routes; x trips; wo work_orders; e timestamptz;
begin
  new.updated_at := now();
  -- a change of vessel, captain or time needs a fresh dispatch clearance
  if tg_op = 'UPDATE' and (new.vessel_id is distinct from old.vessel_id or new.captain_id is distinct from old.captain_id or new.depart_at <> old.depart_at) then
    new.cleared_at := null; new.cleared_by := null; new.clearance := '{}'::jsonb;
  end if;
  select * into r from routes where id = new.route_id;
  if r.company_id is distinct from new.company_id then raise exception 'Choose one of your routes.'; end if;
  if new.arrive_at is null and r.duration_min is not null then new.arrive_at := new.depart_at + make_interval(mins => r.duration_min); end if;
  if new.status = 'Departed' and new.actual_depart is null then new.actual_depart := now(); end if;
  if new.status in ('Arrived', 'Completed') and new.actual_arrive is null then new.actual_arrive := now(); end if;
  if trip_closed(new.status) then return new; end if;
  if tg_op = 'UPDATE' and new.status = old.status and new.status in ('Departed', 'In transit')
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
    select * into x from trips t where t.vessel_id = new.vessel_id and t.id <> new.id and not trip_closed(t.status)
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
    select * into x from trips t where t.id <> new.id and not trip_closed(t.status) and t.depart_at < e and trip_end(t) > new.depart_at
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
  select * into x from trips o where o.id <> t.id and not trip_closed(o.status) and o.depart_at < e and trip_end(o) > t.depart_at
    and (o.captain_id = new.user_id or exists (select 1 from trip_crew c where c.trip_id = o.id and c.user_id = new.user_id)) limit 1;
  if x.id is not null then raise exception 'That person is already on another trip at %.', local_time(new.company_id, x.depart_at); end if;
  if exists (select 1 from leave_requests l where l.company_id = new.company_id and l.user_id = new.user_id and l.status = 'Approved'
             and l.start_date <= e::date and l.end_date >= t.depart_at::date) then
    raise exception 'That person is on approved leave then.';
  end if;
  return new;
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
    select count(*) into ntr from trips t where t.vessel_id = w.vessel_id and not trip_closed(t.status) and t.depart_at < p_end and trip_end(t) > p_start;
    if ntr > 0 then
      select * into tr from trips t where t.vessel_id = w.vessel_id and not trip_closed(t.status) and t.depart_at < p_end and trip_end(t) > p_start order by t.depart_at limit 1;
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

-- Timetable feed (same as 0035) plus trip code, clearance and actual times.
create or replace function schedule_trips(p_company uuid, p_from timestamptz, p_to timestamptz) returns jsonb
  language plpgsql stable security definer set search_path = public as
$$ declare out_t jsonb;
begin
  if not is_company_member(p_company) then raise exception 'Not a member of this company.'; end if;
  if p_to <= p_from or p_to - p_from > interval '93 days' then raise exception 'Choose a window of up to about three months.'; end if;
  select coalesce(jsonb_agg(jsonb_build_object('id', t.id, 'route_id', t.route_id, 'route', r.name, 'origin', r.origin, 'destination', r.destination,
      'vessel_id', t.vessel_id, 'vessel', v.name, 'vessel_code', v.code, 'captain_id', t.captain_id,
      'captain', (select coalesce(p.full_name, split_part(p.email, '@', 1)) from profiles p where p.id = t.captain_id),
      'crew', coalesce((select jsonb_agg(jsonb_build_object('user_id', c.user_id, 'name', coalesce(p.full_name, split_part(p.email, '@', 1)), 'role', c.role, 'meta', c.meta) order by c.role)
                        from trip_crew c join profiles p on p.id = c.user_id where c.trip_id = t.id), '[]'::jsonb),
      'kind', t.kind, 'status', t.status, 'status_reason', t.status_reason, 'depart_at', t.depart_at, 'arrive_at', t.arrive_at,
      'seats_total', t.seats_total, 'seats_booked', t.seats_booked, 'seats_available', t.seats_total - t.seats_booked, 'template_id', t.template_id, 'note', t.note, 'meta', t.meta, 'route_meta', r.meta,
      'code', t.code, 'number', t.number, 'cleared_at', t.cleared_at, 'actual_depart', t.actual_depart, 'actual_arrive', t.actual_arrive, 'closed', trip_closed(t.status))
      order by t.depart_at), '[]'::jsonb)
    into out_t
    from trips t join routes r on r.id = t.route_id left join vessels v on v.id = t.vessel_id
    where t.company_id = p_company and t.depart_at >= p_from and t.depart_at < p_to;
  return jsonb_build_object('trips', out_t, 'summary', (select jsonb_build_object(
      'trips', count(*) filter (where t.status <> 'Cancelled'),
      'vessels', count(distinct t.vessel_id) filter (where t.status <> 'Cancelled'),
      'routes', count(distinct t.route_id) filter (where t.status <> 'Cancelled'),
      'crew', (select count(distinct u) from (select t2.captain_id u from trips t2 where t2.company_id = p_company and t2.status <> 'Cancelled' and t2.depart_at >= p_from and t2.depart_at < p_to
                                              union select c.user_id from trip_crew c join trips t3 on t3.id = c.trip_id where t3.company_id = p_company and t3.status <> 'Cancelled' and t3.depart_at >= p_from and t3.depart_at < p_to) z where u is not null),
      'cancelled', count(*) filter (where t.status = 'Cancelled'),
      'delayed', count(*) filter (where t.status = 'Delayed'),
      'seats', coalesce(sum(t.seats_total) filter (where t.status <> 'Cancelled'), 0))
    from trips t where t.company_id = p_company and t.depart_at >= p_from and t.depart_at < p_to));
end $$;

-- 8. Board feed for operations.html: one day (company local time), KPIs, trips, dispatch queue and advisories.
-- Returns {day, kpis: {active, awaiting, delayed, cancelled, crew_on_duty}, trips: [same as schedule_trips + code, cleared_at, closed],
--          queue: [{id|null, auto, trip_id, code, title, sub, priority, due_at, assignee}], advisories: [{id, kind, severity, title, detail, ...}]}
create function ops_board(p_company uuid, p_day date default null) returns jsonb
  language plpgsql stable security definer set search_path = public as
$$ declare tz text; d date; f timestamptz; tt timestamptz; trips_j jsonb; lead int; q jsonb; adv jsonb; k jsonb;
begin
  if not is_company_member(p_company) then raise exception 'Not a member of this company.'; end if;
  tz := company_tz(p_company);
  d := coalesce(p_day, (now() at time zone tz)::date);
  f := d::timestamp at time zone tz; tt := (d + 1)::timestamp at time zone tz;
  trips_j := schedule_trips(p_company, f, tt)->'trips';
  lead := coalesce(nullif(ops_setting(p_company, '3_dispatch_rules')->>'lead', '')::int, 60);
  select jsonb_build_object(
      'active', count(*) filter (where status in ('Boarding', 'Departed', 'In transit')),
      'awaiting', count(*) filter (where not trip_closed(status) and cleared_at is null and status in ('Scheduled', 'Delayed')),
      'delayed', count(*) filter (where status = 'Delayed'),
      'cancelled', count(*) filter (where status = 'Cancelled'),
      'crew_on_duty', (select count(*) from company_members m where m.company_id = p_company and m.active and m.duty_status = 'On duty'))
    into k from trips where company_id = p_company and depart_at >= f and depart_at < tt;
  select coalesce(jsonb_agg(x order by x->>'pri_rank', x->>'due_at'), '[]'::jsonb) into q from (
    select jsonb_build_object('id', dt.id, 'auto', false, 'trip_id', dt.trip_id, 'code', t.code, 'title', dt.title,
             'sub', coalesce(dt.detail, (select r.name || ' · ' || local_time(p_company, t.depart_at) from routes r where r.id = t.route_id), ''),
             'priority', dt.priority, 'due_at', dt.due_at, 'assignee', dt.assignee, 'blocks_dispatch', dt.blocks_dispatch,
             'pri_rank', case dt.priority when 'High' then 0 when 'Due' then 1 else 2 end) x
      from dispatch_tasks dt left join trips t on t.id = dt.trip_id
      where dt.company_id = p_company and dt.status = 'Open' and (dt.trip_id is null or (t.depart_at >= f and t.depart_at < tt) or dt.due_at < tt)
    union all
    select jsonb_build_object('id', null, 'auto', true, 'trip_id', t.id, 'code', t.code, 'title', 'Clear ' || t.code || ' for dispatch',
             'sub', r.name || ' · ' || local_time(p_company, t.depart_at), 'priority', case when t.depart_at <= now() then 'High' else 'Due' end,
             'due_at', t.depart_at, 'assignee', null, 'blocks_dispatch', true, 'pri_rank', case when t.depart_at <= now() then 0 else 1 end)
      from trips t join routes r on r.id = t.route_id
      where t.company_id = p_company and t.depart_at >= f and t.depart_at < tt and not trip_closed(t.status) and t.cleared_at is null
        and t.status in ('Scheduled', 'Delayed') and t.depart_at <= now() + make_interval(mins => lead)) z;
  select coalesce(jsonb_agg(jsonb_build_object('id', a.id, 'kind', a.kind, 'severity', a.severity, 'title', a.title, 'detail', a.detail,
             'route_id', a.route_id, 'vessel_id', a.vessel_id, 'trip_id', a.trip_id, 'blocks_dispatch', a.blocks_dispatch,
             'starts_at', a.starts_at, 'ends_at', a.ends_at, 'meta', a.meta,
             'tone', case a.severity when 'Critical' then 'warn' when 'Warning' then 'clock' else 'ok' end)
           order by case a.severity when 'Critical' then 0 when 'Warning' then 1 else 2 end, a.starts_at desc), '[]'::jsonb)
    into adv from ops_advisories a where a.company_id = p_company and a.resolved_at is null and a.starts_at < tt and (a.ends_at is null or a.ends_at > f);
  return jsonb_build_object('day', d, 'kpis', k, 'trips', trips_j, 'queue', q, 'advisories', adv);
end $$;
revoke execute on function ops_board(uuid, date) from anon, public;
grant execute on function ops_board(uuid, date) to authenticated;

-- 9. Number the trips that already exist.
do $b$ declare t record; n int; begin
  for t in select id, company_id from trips where number is null order by company_id, created_at loop
    select coalesce(max(number), 0) + 1 into n from trips where company_id = t.company_id;
    update trips set number = n, code = trip_code(t.company_id, n) where id = t.id;
  end loop;
end $b$;
