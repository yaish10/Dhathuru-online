-- Reports hub (reports.html): data for the 8 built-in templates, a log of generated reports, saved custom reports,
-- schedules, and a private bucket for the files the page makes.
--  * run_report(p_company, p_template, p_from, p_to, p_format, p_title) → {run: report_runs row, title, columns, rows, summary}
--    Checks who may see that template, builds the rows from live data and logs the run (status 'Generating').
--    The page turns the rows into PDF / XLSX / CSV, uploads to storage `reports/<company_id>/<run_id>.<ext>`, then calls
--    finish_report_run(p_run, p_path) (or with p_error if it failed). report_data(...) returns the same data without logging.
--  * Templates: trip_performance, revenue_expense, vessel_util, incident_safety, passenger_move, crew_attendance,
--    maint_history, route_compare. A saved custom report (report_defs) points at one of these with its own filters.
--  * Who: owners, admins, Operations and HR can use Reports. revenue_expense needs finance access (owner/admin/Operations);
--    crew_attendance needs HR (owner/admin/HR).
--  * report_schedules are stored for the page; sending them by email waits on an email service (not set up yet).

create or replace function is_company_reports(cid uuid) returns boolean
  language sql stable security definer set search_path = public as
$$ select is_company_ops(cid) or is_company_hr(cid) $$;
revoke execute on function is_company_reports(uuid) from anon, public;
grant execute on function is_company_reports(uuid) to authenticated;

create table report_runs (
  id          uuid primary key default gen_random_uuid(),
  company_id  uuid not null references companies(id) on delete cascade,
  template    text not null check (char_length(template) between 2 and 60),
  def_id      uuid,
  title       text not null check (char_length(btrim(title)) between 2 and 160),
  format      text not null default 'PDF' check (format in ('PDF', 'XLSX', 'CSV')),
  status      text not null default 'Generating' check (status in ('Generating', 'Ready', 'Failed')),
  from_date   date not null,
  to_date     date not null check (to_date >= from_date),
  params      jsonb not null default '{}'::jsonb check (jsonb_typeof(params) = 'object' and pg_column_size(params) <= 16384),
  row_count   integer,
  file_path   text,
  error       text check (error is null or char_length(error) <= 500),
  created_by  uuid references auth.users(id) on delete set null,
  created_at  timestamptz not null default now(),
  finished_at timestamptz
);
create index on report_runs (company_id, created_at desc);
alter table report_runs enable row level security;
create policy rr_select on report_runs for select to authenticated using (is_company_reports(company_id));
create policy rr_delete on report_runs for delete to authenticated using (is_company_reports(company_id) and (created_by = auth.uid() or is_company_admin(company_id)));

create table report_defs (
  id          uuid primary key default gen_random_uuid(),
  company_id  uuid not null references companies(id) on delete cascade,
  name        text not null check (char_length(btrim(name)) between 2 and 120),
  area        text not null default 'Operations' check (char_length(btrim(area)) between 2 and 40),
  template    text not null check (char_length(template) between 2 and 60),
  filters     jsonb not null default '{}'::jsonb check (jsonb_typeof(filters) = 'object' and pg_column_size(filters) <= 16384),
  columns     jsonb not null default '[]'::jsonb check (jsonb_typeof(columns) = 'array'),
  meta        jsonb not null default '{}'::jsonb check (jsonb_typeof(meta) = 'object' and pg_column_size(meta) <= 16384),
  created_by  uuid references auth.users(id) on delete set null,
  created_at  timestamptz not null default now(),
  updated_at  timestamptz not null default now()
);
alter table report_defs enable row level security;
create policy rd_select on report_defs for select to authenticated using (is_company_reports(company_id));
create policy rd_insert on report_defs for insert to authenticated with check (is_company_reports(company_id));
create policy rd_update on report_defs for update to authenticated using (is_company_reports(company_id)) with check (is_company_reports(company_id));
create policy rd_delete on report_defs for delete to authenticated using (is_company_reports(company_id));

create table report_schedules (
  id          uuid primary key default gen_random_uuid(),
  company_id  uuid not null references companies(id) on delete cascade,
  template    text not null check (char_length(template) between 2 and 60),
  def_id      uuid references report_defs(id) on delete cascade,
  title       text not null check (char_length(btrim(title)) between 2 and 160),
  cadence     text not null default 'Weekly' check (cadence in ('Daily', 'Weekly', 'Monthly')),
  format      text not null default 'PDF' check (format in ('PDF', 'XLSX', 'CSV')),
  recipients  text[] not null default '{}' check (cardinality(recipients) <= 20),
  next_run    date,
  active      boolean not null default true,
  meta        jsonb not null default '{}'::jsonb check (jsonb_typeof(meta) = 'object' and pg_column_size(meta) <= 16384),
  created_by  uuid references auth.users(id) on delete set null,
  created_at  timestamptz not null default now()
);
alter table report_schedules enable row level security;
create policy rs_select on report_schedules for select to authenticated using (is_company_reports(company_id));
create policy rs_insert on report_schedules for insert to authenticated with check (is_company_reports(company_id));
create policy rs_update on report_schedules for update to authenticated using (is_company_reports(company_id)) with check (is_company_reports(company_id));
create policy rs_delete on report_schedules for delete to authenticated using (is_company_reports(company_id));

create or replace function report_tables_touch() returns trigger language plpgsql security definer set search_path = public as
$$ begin
  if tg_op = 'INSERT' then new.created_by := coalesce(new.created_by, auth.uid()); end if;
  if tg_table_name = 'report_defs' then new.updated_at := now(); end if;
  return new;
end $$;
create trigger rd_touch before insert or update on report_defs for each row execute function report_tables_touch();
create trigger rs_touch before insert on report_schedules for each row execute function report_tables_touch();
create trigger rd_subscription before insert or update or delete on report_defs for each row execute function reject_if_subscription_expired();
create trigger rs_subscription before insert or update or delete on report_schedules for each row execute function reject_if_subscription_expired();

-- Files: private bucket, <company_id>/<run_id>.<ext>
insert into storage.buckets (id, name, public, file_size_limit, allowed_mime_types)
values ('reports', 'reports', false, 26214400, array['application/pdf', 'text/csv',
        'application/vnd.openxmlformats-officedocument.spreadsheetml.sheet'])
on conflict (id) do nothing;
create policy reports_files_read on storage.objects for select to authenticated
  using (bucket_id = 'reports' and is_company_reports(agreement_file_company(name)));
create policy reports_files_insert on storage.objects for insert to authenticated
  with check (bucket_id = 'reports' and is_company_reports(agreement_file_company(name)));
create policy reports_files_update on storage.objects for update to authenticated
  using (bucket_id = 'reports' and is_company_reports(agreement_file_company(name)));
create policy reports_files_delete on storage.objects for delete to authenticated
  using (bucket_id = 'reports' and is_company_reports(agreement_file_company(name)));

-- Rows for a template. Columns: [{key, label, type}] where type is text / date / time / number / money / percent.
create or replace function report_data(p_company uuid, p_template text, p_from date, p_to date, p_params jsonb default '{}'::jsonb) returns jsonb
  language plpgsql stable security definer set search_path = public as
$$ declare tz text; a timestamptz; b timestamptz; v_cols jsonb; v_rows jsonb; v_summ jsonb := '{}'::jsonb; v_title text; route_f uuid; vessel_f uuid;
begin
  if not is_company_reports(p_company) then raise exception 'Only owners, admins, Operations and HR can run reports.'; end if;
  if p_to < p_from or p_to - p_from > 400 then raise exception 'Choose a period of up to about 13 months.'; end if;
  tz := company_tz(p_company);
  a := p_from::timestamp at time zone tz; b := (p_to + 1)::timestamp at time zone tz;
  route_f := nullif(p_params->>'route_id', '')::uuid; vessel_f := nullif(p_params->>'vessel_id', '')::uuid;

  if p_template = 'trip_performance' then
    v_title := 'Trip performance';
    v_cols := '[{"key":"date","label":"Date","type":"date"},{"key":"code","label":"Trip","type":"text"},{"key":"route","label":"Route","type":"text"},{"key":"vessel","label":"Vessel","type":"text"},{"key":"captain","label":"Captain","type":"text"},{"key":"scheduled","label":"Scheduled","type":"time"},{"key":"departed","label":"Departed","type":"time"},{"key":"delay_min","label":"Delay (min)","type":"number"},{"key":"status","label":"Status","type":"text"},{"key":"reason","label":"Reason","type":"text"},{"key":"passengers","label":"Passengers","type":"number"},{"key":"seats","label":"Seats","type":"number"}]';
    select coalesce(jsonb_agg(x order by x->>'date', x->>'scheduled'), '[]'::jsonb) into v_rows from (
      select jsonb_build_object('date', (t.depart_at at time zone tz)::date, 'code', t.code, 'route', r.name, 'vessel', coalesce(v.code, v.name),
        'captain', p.full_name, 'scheduled', to_char(t.depart_at at time zone tz, 'HH24:MI'), 'departed', to_char(t.actual_depart at time zone tz, 'HH24:MI'),
        'delay_min', case when t.actual_depart is not null then greatest(0, round(extract(epoch from t.actual_depart - t.depart_at) / 60)) end,
        'status', t.status, 'reason', t.status_reason, 'passengers', t.seats_booked, 'seats', t.seats_total) x
      from trips t left join routes r on r.id = t.route_id left join vessels v on v.id = t.vessel_id left join profiles p on p.id = t.captain_id
      where t.company_id = p_company and t.depart_at >= a and t.depart_at < b
        and (route_f is null or t.route_id = route_f) and (vessel_f is null or t.vessel_id = vessel_f)) s;
    select jsonb_build_object('trips', count(*), 'cancelled', count(*) filter (where x->>'status' = 'Cancelled'),
             'on_time_pct', round(100.0 * count(*) filter (where (x->>'delay_min')::numeric <= 5) / nullif(count(*) filter (where x->>'delay_min' is not null), 0)),
             'passengers', coalesce(sum((x->>'passengers')::int), 0)) into v_summ from jsonb_array_elements(v_rows) x;

  elsif p_template = 'revenue_expense' then
    if not is_company_finance(p_company) then raise exception 'Only owners, admins and Operations can see the revenue & expense report.'; end if;
    v_title := 'Revenue & expense';
    v_cols := '[{"key":"date","label":"Date","type":"date"},{"key":"kind","label":"Type","type":"text"},{"key":"category","label":"Category","type":"text"},{"key":"description","label":"Description","type":"text"},{"key":"route","label":"Route","type":"text"},{"key":"vessel","label":"Vessel","type":"text"},{"key":"source","label":"From","type":"text"},{"key":"amount","label":"Amount","type":"money"}]';
    select coalesce(jsonb_agg(x order by x->>'date'), '[]'::jsonb) into v_rows from (
      select jsonb_build_object('date', e.entry_date, 'kind', e.kind, 'category', e.category, 'description', e.description, 'route', r.name,
        'vessel', coalesce(v.code, v.name), 'source', e.source, 'amount', case when e.kind = 'Revenue' then e.amount else -e.amount end) x
      from finance_entries e left join routes r on r.id = e.route_id left join vessels v on v.id = e.vessel_id
      where e.company_id = p_company and e.entry_date between p_from and p_to
        and (route_f is null or e.route_id = route_f) and (vessel_f is null or e.vessel_id = vessel_f)) s;
    select jsonb_build_object('revenue', coalesce(sum((x->>'amount')::numeric) filter (where x->>'kind' = 'Revenue'), 0),
             'costs', coalesce(-sum((x->>'amount')::numeric) filter (where x->>'kind' <> 'Revenue'), 0),
             'net', coalesce(sum((x->>'amount')::numeric), 0), 'currency', (select currency from companies where id = p_company)) into v_summ from jsonb_array_elements(v_rows) x;

  elsif p_template = 'vessel_util' then
    v_title := 'Vessel utilization';
    v_cols := '[{"key":"vessel","label":"Vessel","type":"text"},{"key":"status","label":"Status now","type":"text"},{"key":"trips","label":"Trips","type":"number"},{"key":"sailed","label":"Sailed","type":"number"},{"key":"cancelled","label":"Cancelled","type":"number"},{"key":"hours_at_sea","label":"Hours at sea","type":"number"},{"key":"seats","label":"Seats offered","type":"number"},{"key":"passengers","label":"Passengers","type":"number"},{"key":"load_pct","label":"Load","type":"percent"},{"key":"downtime_hours","label":"Downtime (h)","type":"number"}]';
    select coalesce(jsonb_agg(x order by x->>'vessel'), '[]'::jsonb) into v_rows from (
      select jsonb_build_object('vessel', coalesce(v.code, v.name), 'status', v.status,
        'trips', count(t.id), 'sailed', count(t.id) filter (where t.status in ('Departed', 'In transit', 'Arrived', 'Completed')),
        'cancelled', count(t.id) filter (where t.status = 'Cancelled'),
        'hours_at_sea', round(coalesce(sum(extract(epoch from coalesce(t.actual_arrive, t.arrive_at) - coalesce(t.actual_depart, t.depart_at)) / 3600)
                         filter (where t.status in ('Departed', 'In transit', 'Arrived', 'Completed')), 0)::numeric, 1),
        'seats', coalesce(sum(t.seats_total) filter (where t.status <> 'Cancelled'), 0),
        'passengers', coalesce(sum(t.seats_booked) filter (where t.status <> 'Cancelled'), 0),
        'load_pct', round(100.0 * coalesce(sum(t.seats_booked) filter (where t.status <> 'Cancelled'), 0) / nullif(sum(t.seats_total) filter (where t.status <> 'Cancelled'), 0)),
        'downtime_hours', (select round(coalesce(sum(extract(epoch from least(coalesce(sp.to_at, now()), b) - greatest(sp.from_at, a)) / 3600), 0)::numeric, 1)
                           from vessel_status_periods sp where sp.vessel_id = v.id and sp.status <> 'Operational' and sp.from_at < b and coalesce(sp.to_at, now()) > a)) x
      from vessels v left join trips t on t.vessel_id = v.id and t.depart_at >= a and t.depart_at < b
      where v.company_id = p_company and (vessel_f is null or v.id = vessel_f)
      group by v.id) s;

  elsif p_template = 'incident_safety' then
    v_title := 'Incidents & safety';
    v_cols := '[{"key":"date","label":"Date","type":"date"},{"key":"type","label":"Type","type":"text"},{"key":"severity","label":"Severity","type":"text"},{"key":"title","label":"What happened","type":"text"},{"key":"vessel","label":"Vessel","type":"text"},{"key":"route","label":"Route","type":"text"},{"key":"status","label":"Status","type":"text"},{"key":"closed","label":"Resolved","type":"date"}]';
    select coalesce(jsonb_agg(x order by x->>'date'), '[]'::jsonb) into v_rows from (
      select jsonb_build_object('date', (o.starts_at at time zone tz)::date, 'type', o.kind, 'severity', o.severity, 'title', o.title,
        'vessel', coalesce(v.code, v.name), 'route', r.name, 'status', case when o.resolved_at is null then 'Open' else 'Resolved' end,
        'closed', (o.resolved_at at time zone tz)::date) x
      from ops_advisories o left join vessels v on v.id = o.vessel_id left join routes r on r.id = o.route_id
      where o.company_id = p_company and o.starts_at >= a and o.starts_at < b and (vessel_f is null or o.vessel_id = vessel_f)
      union all
      select jsonb_build_object('date', (d.reported_at at time zone tz)::date, 'type', d.kind || case when d.safety then ' (safety)' else '' end,
        'severity', d.severity, 'title', d.title, 'vessel', coalesce(v.code, v.name), 'route', null, 'status', d.status,
        'closed', (coalesce(d.closed_at, d.repaired_at) at time zone tz)::date)
      from defects d join vessels v on v.id = d.vessel_id
      where d.company_id = p_company and d.reported_at >= a and d.reported_at < b and (d.safety or d.kind = 'Breakdown' or d.severity = 'Critical')
        and (vessel_f is null or d.vessel_id = vessel_f)) s;

  elsif p_template = 'passenger_move' then
    v_title := 'Passenger movement';
    v_cols := '[{"key":"date","label":"Date","type":"date"},{"key":"route","label":"Route","type":"text"},{"key":"trips","label":"Trips","type":"number"},{"key":"booked","label":"Booked","type":"number"},{"key":"checked_in","label":"Checked in","type":"number"},{"key":"boarded","label":"Boarded","type":"number"},{"key":"no_show","label":"No-show","type":"number"},{"key":"cancelled","label":"Cancelled","type":"number"}]';
    select coalesce(jsonb_agg(x order by x->>'date', x->>'route'), '[]'::jsonb) into v_rows from (
      select jsonb_build_object('date', (t.depart_at at time zone tz)::date, 'route', r.name, 'trips', count(distinct t.id),
        'booked', count(bp.id) filter (where bp.status <> 'Cancelled'), 'checked_in', count(bp.id) filter (where bp.status = 'Checked in'),
        'boarded', count(bp.id) filter (where bp.status = 'Boarded'), 'no_show', count(bp.id) filter (where bp.status = 'No-show'),
        'cancelled', count(bp.id) filter (where bp.status = 'Cancelled')) x
      from trips t left join routes r on r.id = t.route_id left join booking_passengers bp on bp.trip_id = t.id
      where t.company_id = p_company and t.depart_at >= a and t.depart_at < b
        and (route_f is null or t.route_id = route_f) and (vessel_f is null or t.vessel_id = vessel_f)
      group by (t.depart_at at time zone tz)::date, r.name) s;

  elsif p_template = 'crew_attendance' then
    if not is_company_hr(p_company) then raise exception 'Only owners, admins and HR can see the crew attendance report.'; end if;
    v_title := 'Crew attendance';
    v_cols := '[{"key":"name","label":"Name","type":"text"},{"key":"designation","label":"Designation","type":"text"},{"key":"rostered","label":"Shifts rostered","type":"number"},{"key":"present","label":"Present","type":"number"},{"key":"late","label":"Late","type":"number"},{"key":"absent","label":"Absent","type":"number"},{"key":"missed_punch","label":"Missed punch","type":"number"},{"key":"leave_days","label":"Leave days","type":"number"},{"key":"trips","label":"Trips crewed","type":"number"}]';
    select coalesce(jsonb_agg(x order by x->>'name'), '[]'::jsonb) into v_rows from (
      select jsonb_build_object('name', coalesce(p.full_name, split_part(p.email, '@', 1)), 'designation', coalesce(jt.title, m.role_label),
        'rostered', (select count(*) from roster_entries re where re.company_id = p_company and re.user_id = m.user_id and re.day between p_from and p_to and re.shift not in ('OFF', 'L')),
        'present', (select count(*) from attendance_records ar where ar.company_id = p_company and ar.user_id = m.user_id and ar.day between p_from and p_to and ar.status = 'Present'),
        'late', (select count(*) from attendance_records ar where ar.company_id = p_company and ar.user_id = m.user_id and ar.day between p_from and p_to and ar.status = 'Late'),
        'absent', (select count(*) from attendance_records ar where ar.company_id = p_company and ar.user_id = m.user_id and ar.day between p_from and p_to and ar.status = 'Absent'),
        'missed_punch', (select count(*) from attendance_records ar where ar.company_id = p_company and ar.user_id = m.user_id and ar.day between p_from and p_to and ar.status = 'Missed punch'),
        'leave_days', (select coalesce(sum(least(l.end_date, p_to) - greatest(l.start_date, p_from) + 1), 0) from leave_requests l
                       where l.company_id = p_company and l.user_id = m.user_id and l.status = 'Approved' and l.start_date <= p_to and l.end_date >= p_from),
        'trips', (select count(*) from trips t where t.company_id = p_company and t.depart_at >= a and t.depart_at < b and t.status <> 'Cancelled'
                    and (t.captain_id = m.user_id or exists (select 1 from trip_crew c where c.trip_id = t.id and c.user_id = m.user_id)))) x
      from company_members m left join profiles p on p.id = m.user_id left join job_titles jt on jt.id = m.job_title_id
      where m.company_id = p_company and m.active) s;

  elsif p_template = 'maint_history' then
    v_title := 'Maintenance history';
    v_cols := '[{"key":"opened","label":"Opened","type":"date"},{"key":"code","label":"Work order","type":"text"},{"key":"vessel","label":"Vessel","type":"text"},{"key":"title","label":"Job","type":"text"},{"key":"kind","label":"Kind","type":"text"},{"key":"priority","label":"Priority","type":"text"},{"key":"status","label":"Status","type":"text"},{"key":"completed","label":"Completed","type":"date"},{"key":"cost","label":"Cost","type":"money"}]';
    select coalesce(jsonb_agg(x order by x->>'opened'), '[]'::jsonb) into v_rows from (
      select jsonb_build_object('opened', (w.created_at at time zone tz)::date, 'code', w.code, 'vessel', coalesce(v.code, v.name), 'title', w.title,
        'kind', w.kind, 'priority', w.priority, 'status', w.status, 'completed', (coalesce(w.completed_at, w.closed_at) at time zone tz)::date,
        'cost', coalesce(w.cost_labour, 0) + coalesce(w.cost_parts, 0) + coalesce(w.cost_other, 0) + coalesce(w.cost_contractor, 0)) x
      from work_orders w join vessels v on v.id = w.vessel_id
      where w.company_id = p_company and (vessel_f is null or w.vessel_id = vessel_f)
        and ((w.created_at >= a and w.created_at < b) or (coalesce(w.completed_at, w.closed_at) >= a and coalesce(w.completed_at, w.closed_at) < b))) s;
    select jsonb_build_object('jobs', count(*), 'cost', coalesce(sum((x->>'cost')::numeric), 0)) into v_summ from jsonb_array_elements(v_rows) x;

  elsif p_template = 'route_compare' then
    v_title := 'Route comparison';
    v_cols := '[{"key":"route","label":"Route","type":"text"},{"key":"trips","label":"Trips","type":"number"},{"key":"cancelled","label":"Cancelled","type":"number"},{"key":"on_time_pct","label":"On time","type":"percent"},{"key":"avg_delay_min","label":"Avg delay (min)","type":"number"},{"key":"passengers","label":"Passengers","type":"number"},{"key":"load_pct","label":"Load","type":"percent"},{"key":"revenue","label":"Revenue","type":"money"}]';
    select coalesce(jsonb_agg(x order by (x->>'trips')::int desc), '[]'::jsonb) into v_rows from (
      select jsonb_build_object('route', r.name, 'trips', count(t.id), 'cancelled', count(t.id) filter (where t.status = 'Cancelled'),
        'on_time_pct', round(100.0 * count(t.id) filter (where t.actual_depart is not null and t.actual_depart <= t.depart_at + interval '5 minutes')
                        / nullif(count(t.id) filter (where t.actual_depart is not null), 0)),
        'avg_delay_min', round(avg(greatest(0, extract(epoch from t.actual_depart - t.depart_at) / 60)) filter (where t.actual_depart is not null)),
        'passengers', coalesce(sum(t.seats_booked) filter (where t.status <> 'Cancelled'), 0),
        'load_pct', round(100.0 * coalesce(sum(t.seats_booked) filter (where t.status <> 'Cancelled'), 0) / nullif(sum(t.seats_total) filter (where t.status <> 'Cancelled'), 0)),
        'revenue', case when is_company_finance(p_company) then (select coalesce(sum(e.amount), 0) from finance_entries e where e.company_id = p_company and e.route_id = r.id
                     and e.kind = 'Revenue' and e.entry_date between p_from and p_to) end) x
      from routes r left join trips t on t.route_id = r.id and t.depart_at >= a and t.depart_at < b
      where r.company_id = p_company and (route_f is null or r.id = route_f)
      group by r.id) s;
  else
    raise exception 'Unknown report "%".', p_template;
  end if;

  return jsonb_build_object('template', p_template, 'title', v_title, 'from', p_from, 'to', p_to, 'columns', v_cols, 'rows', v_rows,
                            'row_count', jsonb_array_length(v_rows), 'summary', v_summ,
                            'company', (select name from companies where id = p_company), 'generated_at', now());
end $$;
revoke execute on function report_data(uuid, text, date, date, jsonb) from anon, public;
grant execute on function report_data(uuid, text, date, date, jsonb) to authenticated;

create or replace function run_report(p_company uuid, p_template text, p_from date, p_to date, p_format text default 'PDF',
                                      p_title text default null, p_params jsonb default '{}'::jsonb, p_def uuid default null) returns jsonb
  language plpgsql security definer set search_path = public as
$$ declare d jsonb; r report_runs;
begin
  d := report_data(p_company, p_template, p_from, p_to, coalesce(p_params, '{}'::jsonb));
  insert into report_runs (company_id, template, def_id, title, format, status, from_date, to_date, params, row_count, created_by)
  values (p_company, p_template, p_def, coalesce(nullif(btrim(p_title), ''), d->>'title'), upper(coalesce(p_format, 'PDF')), 'Generating',
          p_from, p_to, coalesce(p_params, '{}'::jsonb), (d->>'row_count')::int, auth.uid())
  returning * into r;
  return d || jsonb_build_object('run', to_jsonb(r));
end $$;
revoke execute on function run_report(uuid, text, date, date, text, text, jsonb, uuid) from anon, public;
grant execute on function run_report(uuid, text, date, date, text, text, jsonb, uuid) to authenticated;

create or replace function finish_report_run(p_run uuid, p_path text default null, p_error text default null) returns report_runs
  language plpgsql security definer set search_path = public as
$$ declare r report_runs;
begin
  select * into r from report_runs where id = p_run;
  if not found then raise exception 'Report not found.'; end if;
  if not is_company_reports(r.company_id) then raise exception 'Not allowed.'; end if;
  if p_path is not null and split_part(p_path, '/', 1) <> r.company_id::text then raise exception 'File must be saved under the company folder.'; end if;
  update report_runs set status = case when p_error is null then 'Ready' else 'Failed' end, file_path = coalesce(p_path, file_path),
         error = left(p_error, 500), finished_at = now()
   where id = p_run returning * into r;
  return r;
end $$;
revoke execute on function finish_report_run(uuid, text, text) from anon, public;
grant execute on function finish_report_run(uuid, text, text) to authenticated;

-- KPI strip on the Reports page.
create or replace function reports_overview(p_company uuid) returns jsonb
  language sql stable security definer set search_path = public as
$$ select case when not is_company_reports(p_company) then null else jsonb_build_object(
    'templates', 8 + (select count(*) from report_defs where company_id = p_company),
    'exports_30d', (select count(*) from report_runs where company_id = p_company and status = 'Ready' and created_at > now() - interval '30 days'),
    'scheduled', (select count(*) from report_schedules where company_id = p_company and active),
    'data_sources', 6,
    'recent', (select coalesce(jsonb_agg(to_jsonb(x) order by x.created_at desc), '[]'::jsonb) from
                (select id, template, title, format, status, from_date, to_date, row_count, file_path, created_at from report_runs
                 where company_id = p_company order by created_at desc limit 10) x)) end $$;
revoke execute on function reports_overview(uuid) from anon, public;
grant execute on function reports_overview(uuid) to authenticated;
