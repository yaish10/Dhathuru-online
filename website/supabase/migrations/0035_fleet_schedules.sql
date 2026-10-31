-- Fleet details on vessels, and Operations schedules: routes, trips (planned sailings) with captain and crew,
-- repeating schedule templates, copy/import tools, clash checks against other trips and planned maintenance.
-- Asked for by Cursor in DATABASE_HANDOFF.md (Fleet UI and Schedules UI, 21 Oct 2026). UI is Cursor's.
--
-- Built to grow without new SQL:
--   * every new table (and vessels) has `meta jsonb` for extra fields the UI adds later (any keys, up to 16 KB);
--   * trip kinds, crew roles etc. are free text (the lists live in Operations/Schedule settings, not in CHECKs);
--   * Operations may edit settings 3_ (Operations), 4_ (Routes & Locations), 5_ (Schedule) and 6_ (Fleet),
--     so new options/rules are just new settings keys;
--   * only statuses that the database itself acts on are fixed (trip status, because clash checks use it).

-- 1. Fleet: capacity, current route and standby on vessels.
--    Standby is a flag (operational but not in use), so maintenance statuses and return to service stay as they are.
alter table vessels
  add column passenger_capacity integer check (passenger_capacity is null or passenger_capacity between 0 and 5000),
  add column crew_capacity      integer check (crew_capacity is null or crew_capacity between 0 and 500),
  add column assigned_route     text check (assigned_route is null or char_length(assigned_route) <= 120),
  add column standby            boolean not null default false,
  add column meta               jsonb not null default '{}'::jsonb check (jsonb_typeof(meta) = 'object' and pg_column_size(meta) <= 16384);

-- Operations people: owners, admins and the Operations role (and the platform owner).
create function is_company_ops(cid uuid) returns boolean
  language sql stable security definer set search_path = public as
$$ select is_platform_admin()
     or exists (select 1 from company_members where company_id = cid and user_id = auth.uid() and active and role::text in ('owner', 'admin', 'operations')) $$;
revoke execute on function is_company_ops(uuid) from anon, public;
grant execute on function is_company_ops(uuid) to authenticated;

create function ops_user_ids(p_company uuid) returns uuid[]
  language sql stable security definer set search_path = public as
$$ select coalesce(array_agg(user_id), '{}') from company_members where company_id = p_company and active and role::text in ('owner', 'admin', 'operations') $$;
revoke execute on function ops_user_ids(uuid) from anon, public;

-- 2. Routes.
create table routes (
  id           uuid primary key default gen_random_uuid(),
  company_id   uuid not null references companies(id) on delete cascade,
  code         text check (code is null or char_length(btrim(code)) between 1 and 20),
  name         text not null check (char_length(btrim(name)) between 2 and 120),
  origin       text not null check (char_length(btrim(origin)) between 1 and 80),
  destination  text not null check (char_length(btrim(destination)) between 1 and 80),
  stops        text[] not null default '{}',
  duration_min integer check (duration_min is null or duration_min between 1 and 2880),
  distance_nm  numeric(7, 1) check (distance_nm is null or distance_nm >= 0),
  fare         numeric(10, 2) check (fare is null or fare >= 0),
  active       boolean not null default true,
  note         text check (note is null or char_length(note) <= 300),
  meta         jsonb not null default '{}'::jsonb check (jsonb_typeof(meta) = 'object' and pg_column_size(meta) <= 16384),
  created_at   timestamptz not null default now()
);
create unique index routes_name_key on routes (company_id, lower(name));
create unique index routes_code_key on routes (company_id, lower(code)) where code is not null;
alter table routes enable row level security;
create policy rte_select on routes for select to authenticated using (is_company_member(company_id));
create policy rte_insert on routes for insert to authenticated with check (is_company_ops(company_id));
create policy rte_update on routes for update to authenticated using (is_company_ops(company_id)) with check (is_company_ops(company_id));
create policy rte_delete on routes for delete to authenticated using (is_company_ops(company_id));
create trigger rte_subscription before insert or update or delete on routes for each row execute function reject_if_subscription_expired();

-- 3. Repeating schedule templates (e.g. "Male → Thulusdhoo 07:00, Sun–Thu").
create table schedule_templates (
  id           uuid primary key default gen_random_uuid(),
  company_id   uuid not null references companies(id) on delete cascade,
  name         text not null check (char_length(btrim(name)) between 2 and 80),
  route_id     uuid not null references routes(id) on delete cascade,
  vessel_id    uuid references vessels(id) on delete set null,
  captain_id   uuid,
  kind         text not null default 'Scheduled' check (char_length(btrim(kind)) between 2 and 40),
  depart_time  time not null,
  duration_min integer check (duration_min is null or duration_min between 1 and 2880),
  weekdays     smallint[] not null default '{1,2,3,4,5,6,7}' check (weekdays <@ '{1,2,3,4,5,6,7}'::smallint[] and cardinality(weekdays) > 0),
  seats        integer check (seats is null or seats between 0 and 5000),
  valid_from   date,
  valid_to     date,
  active       boolean not null default true,
  meta         jsonb not null default '{}'::jsonb check (jsonb_typeof(meta) = 'object' and pg_column_size(meta) <= 16384),
  created_at   timestamptz not null default now(),
  check (valid_to is null or valid_from is null or valid_to >= valid_from),
  foreign key (company_id, captain_id) references company_members (company_id, user_id) on delete set null (captain_id)
);
alter table schedule_templates enable row level security;
create policy stp_select on schedule_templates for select to authenticated using (is_company_member(company_id));
create policy stp_insert on schedule_templates for insert to authenticated with check (is_company_ops(company_id));
create policy stp_update on schedule_templates for update to authenticated using (is_company_ops(company_id)) with check (is_company_ops(company_id));
create policy stp_delete on schedule_templates for delete to authenticated using (is_company_ops(company_id));
create trigger stp_subscription before insert or update or delete on schedule_templates for each row execute function reject_if_subscription_expired();

-- 4. Trips (planned sailings).
create table trips (
  id              uuid primary key default gen_random_uuid(),
  company_id      uuid not null references companies(id) on delete cascade,
  route_id        uuid not null references routes(id) on delete restrict,
  vessel_id       uuid references vessels(id) on delete set null,
  captain_id      uuid,
  template_id     uuid references schedule_templates(id) on delete set null,
  kind            text not null default 'Scheduled' check (char_length(btrim(kind)) between 2 and 40),
  status          text not null default 'Scheduled' check (status in ('Scheduled', 'Boarding', 'Departed', 'Arrived', 'Delayed', 'Cancelled')),
  depart_at       timestamptz not null,
  arrive_at       timestamptz,
  seats_total     integer check (seats_total is null or seats_total between 0 and 5000),
  seats_booked    integer not null default 0 check (seats_booked >= 0),
  status_reason   text check (status_reason is null or char_length(status_reason) <= 200),
  note            text check (note is null or char_length(note) <= 500),
  actual_depart   timestamptz,
  actual_arrive   timestamptz,
  meta            jsonb not null default '{}'::jsonb check (jsonb_typeof(meta) = 'object' and pg_column_size(meta) <= 16384),
  created_by      uuid references auth.users(id) on delete set null,
  created_at      timestamptz not null default now(),
  updated_at      timestamptz not null default now(),
  check (arrive_at is null or arrive_at > depart_at),
  check (seats_total is null or seats_booked <= seats_total),
  foreign key (company_id, captain_id) references company_members (company_id, user_id) on delete set null (captain_id)
);
create index on trips (company_id, depart_at);
create index on trips (vessel_id, depart_at);
create unique index trips_template_once on trips (template_id, depart_at) where template_id is not null;
alter table trips enable row level security;
create policy trp_select on trips for select to authenticated using (is_company_member(company_id));
create policy trp_insert on trips for insert to authenticated with check (is_company_ops(company_id));
create policy trp_update on trips for update to authenticated using (is_company_ops(company_id)) with check (is_company_ops(company_id));
create policy trp_delete on trips for delete to authenticated using (is_company_ops(company_id));
create trigger trp_subscription before insert or update or delete on trips for each row execute function reject_if_subscription_expired();

create table trip_crew (
  trip_id    uuid not null references trips(id) on delete cascade,
  company_id uuid not null,
  user_id    uuid not null,
  role       text not null default 'Crew' check (char_length(btrim(role)) between 2 and 40),
  meta       jsonb not null default '{}'::jsonb check (jsonb_typeof(meta) = 'object' and pg_column_size(meta) <= 16384),
  primary key (trip_id, user_id),
  foreign key (company_id, user_id) references company_members (company_id, user_id) on delete cascade
);
create index on trip_crew (user_id);
alter table trip_crew enable row level security;
create policy tcr_select on trip_crew for select to authenticated using (is_company_member(company_id));
create policy tcr_insert on trip_crew for insert to authenticated with check (is_company_ops(company_id) and exists (select 1 from trips t where t.id = trip_id and t.company_id = trip_crew.company_id));
create policy tcr_update on trip_crew for update to authenticated using (is_company_ops(company_id)) with check (is_company_ops(company_id));
create policy tcr_delete on trip_crew for delete to authenticated using (is_company_ops(company_id));

-- End of a trip for clash checks: arrival, else route duration, else one hour.
create function trip_end(t trips) returns timestamptz
  language sql stable security definer set search_path = public as
$$ select coalesce(t.arrive_at, t.depart_at + make_interval(mins => coalesce((select r.duration_min from routes r where r.id = t.route_id), 60))) $$;

-- Rules every trip must pass (cancelled and finished trips are not checked):
-- route/vessel/captain belong to the company, the vessel is not out of service, not booked out of service by a planned
-- maintenance job, not on another trip at the same time, seats fit the vessel, and the captain is not on another trip.
create function trips_guard() returns trigger
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
      raise exception '% is booked for maintenance then (% %, % to %).', v.name, wo.code, wo.title, to_char(wo.planned_start, 'DD Mon HH24:MI'), to_char(wo.planned_end, 'DD Mon HH24:MI');
    end if;
    select * into x from trips t where t.vessel_id = new.vessel_id and t.id <> new.id and t.status not in ('Cancelled', 'Arrived')
      and t.depart_at < e and trip_end(t) > new.depart_at order by t.depart_at limit 1;
    if x.id is not null then
      raise exception '% already has a trip at % (%).', v.name, to_char(x.depart_at, 'DD Mon HH24:MI'), (select name from routes where id = x.route_id);
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
    if x.id is not null then raise exception 'The captain is already on another trip at %.', to_char(x.depart_at, 'DD Mon HH24:MI'); end if;
    if exists (select 1 from leave_requests l where l.company_id = new.company_id and l.user_id = new.captain_id and l.status = 'Approved'
               and l.start_date <= e::date and l.end_date >= new.depart_at::date) then
      raise exception 'The captain is on approved leave then.';
    end if;
  end if;
  return new;
end $$;
create trigger trp_guard before insert or update on trips for each row execute function trips_guard();

create function trip_crew_guard() returns trigger
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
  if x.id is not null then raise exception 'That person is already on another trip at %.', to_char(x.depart_at, 'DD Mon HH24:MI'); end if;
  if exists (select 1 from leave_requests l where l.company_id = new.company_id and l.user_id = new.user_id and l.status = 'Approved'
             and l.start_date <= e::date and l.end_date >= t.depart_at::date) then
    raise exception 'That person is on approved leave then.';
  end if;
  return new;
end $$;
create trigger tcr_guard before insert or update on trip_crew for each row execute function trip_crew_guard();

-- 5. Change a trip's status (Operations, or the trip's captain). Delays and cancellations notify the captain, crew and Operations.
create function set_trip_status(p_id uuid, p_status text, p_reason text default null, p_new_depart timestamptz default null) returns trips
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
      (select name from routes where id = t.route_id) || ' ' || to_char(t.depart_at, 'DD Mon HH24:MI') || ' ' || lower(p_status), coalesce(p_reason, ''));
  end if;
  return t;
end $$;
revoke execute on function set_trip_status(uuid, text, text, timestamptz) from anon, public;
grant execute on function set_trip_status(uuid, text, text, timestamptz) to authenticated;

-- 6. Create trips from a template for a date range. Days that clash are skipped and reported, not failed.
-- Times are the company's local time (companies.timezone, else Indian/Maldives).
create function company_tz(p_company uuid) returns text
  language sql stable security definer set search_path = public as
$$ select coalesce((select nullif(timezone, '') from companies where id = p_company), 'Indian/Maldives') $$;
revoke execute on function company_tz(uuid) from anon, public;

create function generate_trips(p_template uuid, p_from date, p_to date) returns jsonb
  language plpgsql security definer set search_path = public as
$$ declare s schedule_templates; d date; tz text; made int := 0; skipped jsonb := '[]'::jsonb; dep timestamptz;
begin
  select * into s from schedule_templates where id = p_template;
  if not found then raise exception 'Template not found.'; end if;
  if not is_company_ops(s.company_id) then raise exception 'Only Operations can create trips.'; end if;
  if p_to < p_from or p_to - p_from > 92 then raise exception 'Choose up to about three months at a time.'; end if;
  tz := company_tz(s.company_id);
  for d in select g::date from generate_series(greatest(p_from, coalesce(s.valid_from, p_from)), least(p_to, coalesce(s.valid_to, p_to)), interval '1 day') g loop
    continue when not (extract(isodow from d)::smallint = any(s.weekdays));
    dep := (d + s.depart_time) at time zone tz;
    continue when exists (select 1 from trips where template_id = s.id and depart_at = dep);
    begin
      insert into trips (company_id, route_id, vessel_id, captain_id, template_id, kind, depart_at, arrive_at, seats_total, meta, created_by)
        values (s.company_id, s.route_id, s.vessel_id, s.captain_id, s.id, s.kind, dep, case when s.duration_min is not null then dep + make_interval(mins => s.duration_min) end, s.seats, s.meta, auth.uid());
      made := made + 1;
    exception when others then
      skipped := skipped || jsonb_build_object('date', d, 'error', sqlerrm);
    end;
  end loop;
  return jsonb_build_object('created', made, 'skipped', skipped);
end $$;
revoke execute on function generate_trips(uuid, date, date) from anon, public;
grant execute on function generate_trips(uuid, date, date) to authenticated;

-- Copy every (not cancelled) trip of one day to another day, with crew. Clashes are skipped and reported.
create function copy_trips(p_company uuid, p_from_day date, p_to_day date) returns jsonb
  language plpgsql security definer set search_path = public as
$$ declare t trips; n trips; tz text; made int := 0; skipped jsonb := '[]'::jsonb; shift interval;
begin
  if not is_company_ops(p_company) then raise exception 'Only Operations can create trips.'; end if;
  if p_from_day = p_to_day then raise exception 'Choose a different day to copy to.'; end if;
  tz := company_tz(p_company);
  shift := (p_to_day - p_from_day) * interval '1 day';
  for t in select * from trips where company_id = p_company and status <> 'Cancelled'
             and (depart_at at time zone tz)::date = p_from_day order by depart_at loop
    begin
      insert into trips (company_id, route_id, vessel_id, captain_id, kind, depart_at, arrive_at, seats_total, note, meta, created_by)
        values (p_company, t.route_id, t.vessel_id, t.captain_id, t.kind, t.depart_at + shift, t.arrive_at + shift, t.seats_total, t.note, t.meta, auth.uid())
        returning * into n;
      insert into trip_crew (trip_id, company_id, user_id, role, meta) select n.id, p_company, c.user_id, c.role, c.meta from trip_crew c where c.trip_id = t.id;
      made := made + 1;
    exception when others then
      skipped := skipped || jsonb_build_object('trip', (select name from routes where id = t.route_id) || ' ' || to_char(t.depart_at at time zone tz, 'HH24:MI'), 'error', sqlerrm);
    end;
  end loop;
  return jsonb_build_object('created', made, 'skipped', skipped);
end $$;
revoke execute on function copy_trips(uuid, date, date) from anon, public;
grant execute on function copy_trips(uuid, date, date) to authenticated;

-- Import trips from a spreadsheet (CSV parsed in the browser). Each row:
-- {route (name or code) | route_id, vessel (code or name) | vessel_id, date 'YYYY-MM-DD', time 'HH:MI' | depart_at, arrive_time | arrive_at, kind, seats, note, meta {...}}
-- Returns {created, errors: [{row, error}]}; good rows are saved even if others fail.
create function import_trips(p_company uuid, p_rows jsonb) returns jsonb
  language plpgsql security definer set search_path = public as
$$ declare row_j jsonb; i int := 0; made int := 0; errs jsonb := '[]'::jsonb; rid uuid; vid uuid; dep timestamptz; arr timestamptz; tz text;
begin
  if not is_company_ops(p_company) then raise exception 'Only Operations can import trips.'; end if;
  if jsonb_typeof(p_rows) <> 'array' or jsonb_array_length(p_rows) = 0 then raise exception 'Nothing to import.'; end if;
  if jsonb_array_length(p_rows) > 1000 then raise exception 'Import up to 1000 trips at a time.'; end if;
  tz := company_tz(p_company);
  for row_j in select * from jsonb_array_elements(p_rows) loop
    i := i + 1;
    begin
      rid := coalesce(nullif(row_j->>'route_id', '')::uuid,
        (select id from routes where company_id = p_company and (lower(name) = lower(btrim(row_j->>'route')) or lower(code) = lower(btrim(row_j->>'route'))) limit 1));
      if rid is null then raise exception 'Route "%" not found.', coalesce(row_j->>'route', ''); end if;
      vid := null;
      if coalesce(row_j->>'vessel_id', row_j->>'vessel', '') <> '' then
        vid := coalesce(nullif(row_j->>'vessel_id', '')::uuid,
          (select id from vessels where company_id = p_company and (lower(code) = lower(btrim(row_j->>'vessel')) or lower(name) = lower(btrim(row_j->>'vessel'))) limit 1));
        if vid is null then raise exception 'Vessel "%" not found.', row_j->>'vessel'; end if;
      end if;
      dep := coalesce(nullif(row_j->>'depart_at', '')::timestamptz, ((row_j->>'date')::date + (row_j->>'time')::time) at time zone tz);
      if dep is null then raise exception 'Give a date and time.'; end if;
      arr := coalesce(nullif(row_j->>'arrive_at', '')::timestamptz, case when nullif(row_j->>'arrive_time', '') is not null
        then ((dep at time zone tz)::date + (row_j->>'arrive_time')::time) at time zone tz end);
      insert into trips (company_id, route_id, vessel_id, kind, depart_at, arrive_at, seats_total, note, meta, created_by)
        values (p_company, rid, vid, coalesce(nullif(btrim(row_j->>'kind'), ''), 'Scheduled'), dep, arr, nullif(row_j->>'seats', '')::int, nullif(btrim(row_j->>'note'), ''),
                case when jsonb_typeof(row_j->'meta') = 'object' then row_j->'meta' else '{}'::jsonb end, auth.uid());
      made := made + 1;
    exception when others then
      errs := errs || jsonb_build_object('row', i, 'error', sqlerrm);
    end;
  end loop;
  return jsonb_build_object('created', made, 'errors', errs);
end $$;
revoke execute on function import_trips(uuid, jsonb) from anon, public;
grant execute on function import_trips(uuid, jsonb) to authenticated;

-- 7. Timetable feed for the Schedules page: trips in a window with names, plus the summary tiles.
-- Returns {trips: [{id, route_id, route, origin, destination, vessel_id, vessel, vessel_code, captain_id, captain, crew: [{user_id, name, role}],
--          kind, status, status_reason, depart_at, arrive_at, seats_total, seats_booked, seats_available, template_id}],
--          summary: {trips, vessels, routes, crew, cancelled, delayed, seats}}
create function schedule_trips(p_company uuid, p_from timestamptz, p_to timestamptz) returns jsonb
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
      'seats_total', t.seats_total, 'seats_booked', t.seats_booked, 'seats_available', t.seats_total - t.seats_booked, 'template_id', t.template_id, 'note', t.note, 'meta', t.meta, 'route_meta', r.meta)
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
revoke execute on function schedule_trips(uuid, timestamptz, timestamptz) from anon, public;
grant execute on function schedule_trips(uuid, timestamptz, timestamptz) to authenticated;

-- 8. Maintenance planning sees trips: planning a job that takes a vessel out of service over booked trips is refused
--    (same as 0034 otherwise). Cancel or move the trips, or give them another vessel, first.
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
      raise exception '% is already booked out of service for % (% to %).', v.name, clash.code, to_char(clash.planned_start, 'DD Mon HH24:MI'), to_char(clash.planned_end, 'DD Mon HH24:MI');
    end if;
    select count(*) into ntr from trips t where t.vessel_id = w.vessel_id and t.status not in ('Cancelled', 'Arrived') and t.depart_at < p_end and trip_end(t) > p_start;
    if ntr > 0 then
      select * into tr from trips t where t.vessel_id = w.vessel_id and t.status not in ('Cancelled', 'Arrived') and t.depart_at < p_end and trip_end(t) > p_start order by t.depart_at limit 1;
      raise exception '% has % trip(s) booked then (first: % %). Ask Operations to move them or use another vessel.', v.name, ntr,
        (select name from routes where id = tr.route_id), to_char(tr.depart_at, 'DD Mon HH24:MI');
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
  perform maint_log(w.company_id, w.vessel_id, 'plan', w.id, w.code || case when was is null then ' planned ' else ' moved to ' end || to_char(p_start, 'DD Mon HH24:MI') || '–' || to_char(p_end, 'DD Mon HH24:MI')
    || case when w.takes_out_of_service then ' (vessel out of service)' else '' end);
  if w.takes_out_of_service then
    perform notify_many(w.company_id, maint_user_ids(w.company_id), 'maint_plan', to_char(now(), 'YYYYMMDDHH24MI'), 'work_order', w.id::text,
      v.name || case when was is null then ' booked out of service' else ' maintenance moved' end,
      to_char(p_start, 'DD Mon HH24:MI') || ' to ' || to_char(p_end, 'DD Mon HH24:MI') || ' · ' || w.code || ' ' || w.title);
  end if;
  if w.assignee is not null then
    perform notify_user(w.company_id, w.assignee, 'work_order', 'plan' || to_char(now(), 'HH24MI'), 'work_order', w.id::text,
      w.code || ' planned for ' || to_char(p_start, 'DD Mon HH24:MI'), w.title);
  end if;
  return w;
end $$;

-- 9. Operations may change Operations (3_), Routes & Locations (4_), Schedule (5_) and Fleet (6_) settings,
--    so new options and rules for these pages need only a new settings key, never new SQL.
create or replace function set_company_setting(p_company uuid, p_key text, p_value jsonb) returns void
  language plpgsql security definer set search_path = public as
$$ begin
  if not (is_company_admin(p_company)
          or ((p_key like '8\_%' or p_key like '16\_%') and is_company_hr(p_company))
          or ((p_key like '13\_%' or p_key like '14\_%' or p_key like '17\_%') and is_company_it(p_company))
          or (p_key like '10\_%' and is_company_maint(p_company))
          or ((p_key like '3\_%' or p_key like '4\_%' or p_key like '5\_%' or p_key like '6\_%') and is_company_ops(p_company))) then
    raise exception 'Only owners and admins can change settings.';
  end if;
  if p_key !~ '^[a-z0-9_]{1,60}$' then raise exception 'Invalid setting key.'; end if;
  if pg_column_size(p_value) > 100000 then raise exception 'Setting is too large.'; end if;
  update companies set settings = jsonb_set(coalesce(settings, '{}'::jsonb), array[p_key], p_value, true) where id = p_company;
  insert into company_audit (company_id, actor, action, detail) values (p_company, auth.uid(), 'setting_changed', p_key);
end $$;
