-- Timesheets: scheduled hours (roster + Shift Definitions, minus breaks) vs actual hours (clock-in/out) per person and week.
-- HR approves a week, which locks that person's attendance for those days. Candidate overtime is worked out only
-- when a week is approved (never from the roster alone), using Overtime Rules, and stays "not paid yet" until payroll.
-- Fingerprint/RFID devices are not connected yet; that needs the device maker's API.

-- 1. Approved weeks (one row = an approved, locked week). Rows are written only by approve_timesheet().
create table timesheet_weeks (
  company_id     uuid not null,
  user_id        uuid not null,
  week_start     date not null,
  scheduled_min  integer not null default 0,
  actual_min     integer not null default 0,
  overtime_min   integer not null default 0,
  holiday_min    integer not null default 0,
  overtime_rate  numeric not null default 1.25,
  holiday_rate   numeric not null default 2,
  days           jsonb not null default '[]'::jsonb,
  overtime_paid  boolean not null default false,
  note           text check (note is null or char_length(note) <= 200),
  approved_by    uuid references auth.users(id) on delete set null,
  approved_at    timestamptz not null default now(),
  primary key (company_id, user_id, week_start),
  foreign key (company_id, user_id) references company_members (company_id, user_id) on delete cascade
);
create index on timesheet_weeks (company_id, week_start);
alter table timesheet_weeks enable row level security;
create policy tsw_select on timesheet_weeks for select to authenticated
  using (is_company_hr(company_id) or user_id = auth.uid());
create trigger tsw_subscription before insert or update or delete on timesheet_weeks
  for each row execute function reject_if_subscription_expired();

-- A week starts on the day after the weekend in Duty Roster settings (Friday & Saturday weekend: Sunday to Saturday).
create function timesheet_week_start(p_company uuid, p_day date) returns date
  language sql stable as
$$ select p_day - ((extract(dow from p_day)::int - (case coalesce((select settings->'8_duty_roster'->>'weekend' from companies where id = p_company), 'Friday & Saturday')
     when 'Saturday & Sunday' then 1 when 'Friday only' then 6 when 'None' then 1 else 0 end) + 7) % 7) $$;

create function timesheet_locked(p_company uuid, p_user uuid, p_day date) returns boolean
  language sql stable security definer set search_path = public as
$$ select exists (select 1 from timesheet_weeks t where t.company_id = p_company and t.user_id = p_user
     and p_day between t.week_start and t.week_start + 6) $$;
revoke execute on function timesheet_locked(uuid, uuid, date) from anon, public;

-- 2. Locked days cannot be changed or corrected (HR reopens the week first).
create function attendance_lock_guard() returns trigger
  language plpgsql security definer set search_path = public as
$$ begin
  if timesheet_locked(new.company_id, new.user_id, new.day) then
    raise exception 'The timesheet for % is approved and locked. HR can reopen the week first.', to_char(new.day, 'DD Mon');
  end if;
  return new;
end $$;
create trigger att_lock before insert or update on attendance_records
  for each row execute function attendance_lock_guard();
create trigger attc_lock before insert on attendance_corrections
  for each row execute function attendance_lock_guard();

-- Same as 0021, but skips locked days.
create or replace function refresh_attendance(p_company uuid, p_day date) returns integer
  language plpgsql security definer set search_path = public as
$$ declare m record; n int := 0; rec attendance_records; sh text; st text;
begin
  if not (is_company_hr(p_company) or is_company_member(p_company) or is_platform_admin()) then
    raise exception 'Not a member of this company.';
  end if;
  for m in select user_id from company_members where company_id = p_company and active loop
    if timesheet_locked(p_company, m.user_id, p_day) then continue; end if;
    select * into rec from attendance_records where company_id = p_company and user_id = m.user_id and day = p_day;
    sh := coalesce(rec.scheduled_shift, attendance_shift_of(p_company, m.user_id, p_day));
    if rec.company_id is null then
      st := attendance_derive_status(p_company, m.user_id, p_day, null, null, sh);
      if st is null then continue; end if;
      insert into attendance_records (company_id, user_id, day, status, scheduled_shift, source, updated_by)
        values (p_company, m.user_id, p_day, st, sh, 'auto', auth.uid())
        on conflict do nothing;
      n := n + 1;
    elsif rec.source = 'auto' or rec.clock_in is not null then
      st := attendance_derive_status(p_company, m.user_id, p_day, rec.clock_in, rec.clock_out, sh);
      if st is null then continue; end if;
      if st is distinct from rec.status or sh is distinct from rec.scheduled_shift then
        update attendance_records set status = st, scheduled_shift = sh, updated_at = now()
          where company_id = p_company and user_id = m.user_id and day = p_day;
        n := n + 1;
      end if;
    end if;
  end loop;
  return n;
end $$;

-- 3. One person's days: scheduled vs actual minutes and exceptions. Internal (callers check access).
create function timesheet_days(p_company uuid, p_user uuid, p_from date, p_to date) returns jsonb
  language plpgsql stable security definer set search_path = public as
$$ declare
  st jsonb; tz text; late_m int; abs_m int; hol text[]; d date; r attendance_records; code text; sh jsonb;
  working boolean; lv boolean; a timestamptz; b timestamptz; br int; sched int; act int;
  f_missed boolean; f_late boolean; f_early boolean; f_absent boolean; pend jsonb; res jsonb := '[]'::jsonb;
begin
  select c.settings, coalesce(c.timezone, 'Indian/Maldives') into st, tz from companies c where c.id = p_company;
  st := coalesce(st, '{}'::jsonb);
  late_m := coalesce(nullif(st->'8_attendance_rules'->>'late', '')::int, 10);
  abs_m := coalesce(nullif(st->'8_attendance_rules'->>'absent', '')::int, 60);
  hol := array(select left(btrim(case when jsonb_typeof(x) = 'string' then x #>> '{}' else x->>'name' end), 10)
    from jsonb_array_elements(case when jsonb_typeof(st->'5_holiday_calendar') = 'array' then st->'5_holiday_calendar' else '[]'::jsonb end) x);
  for d in select g::date from generate_series(p_from, p_to, interval '1 day') g loop
    r := null;
    select * into r from attendance_records ar where ar.company_id = p_company and ar.user_id = p_user and ar.day = d;
    code := coalesce((select re.shift from roster_entries re where re.company_id = p_company and re.user_id = p_user and re.day = d), r.scheduled_shift);
    lv := coalesce(code = 'L', false) or coalesce(r.status = 'On leave', false) or exists (select 1 from leave_requests l where l.company_id = p_company and l.user_id = p_user
      and l.status = 'Approved' and d between l.start_date and l.end_date);
    working := roster_is_working(code) and not lv;
    a := null; b := null; br := 0; sched := 0;
    if roster_is_working(code) then
      sh := roster_shift_json(st, code);
      br := greatest(0, coalesce(nullif(sh->>'brk', '')::int, 0));
      begin
        a := (d::text || ' ' || coalesce(sh->>'start', '08:00'))::timestamp at time zone tz;
        b := (d::text || ' ' || coalesce(sh->>'end', case when code = 'TRN' then '16:00' else '17:00' end))::timestamp at time zone tz;
      exception when others then
        a := (d::text || ' 08:00')::timestamp at time zone tz; b := a + interval '8 hours';
      end;
      if b <= a then b := b + interval '1 day'; end if;
      if working then sched := greatest(0, (extract(epoch from b - a) / 60)::int - br); end if;
    end if;
    act := 0;
    if r.clock_in is not null and r.clock_out is not null then
      act := (extract(epoch from r.clock_out - r.clock_in) / 60)::int;
      if roster_is_working(code) and act > br then act := act - br; end if;
    end if;
    f_missed := (r.clock_in is null) <> (r.clock_out is null)
      and (r.clock_in is null or d < current_date or (b is not null and now() > b + interval '15 minutes'));
    f_late := working and r.clock_in is not null and r.clock_in > a + make_interval(mins => late_m);
    f_early := working and r.clock_out is not null and r.clock_out < b - make_interval(mins => late_m);
    f_absent := not lv and r.clock_in is null and r.clock_out is null
      and coalesce(r.status, '') not in ('Rest day', 'On leave', 'Present', 'Late')
      and (r.status = 'Absent' or (working and now() > a + make_interval(mins => abs_m)));
    select coalesce(jsonb_agg(jsonb_build_object('id', c.id, 'clock_in', c.clock_in, 'clock_out', c.clock_out, 'status', c.status, 'reason', c.reason) order by c.created_at), '[]'::jsonb)
      into pend from attendance_corrections c where c.company_id = p_company and c.user_id = p_user and c.day = d and c.status_now = 'Pending';
    res := res || jsonb_build_object(
      'day', d, 'shift', code, 'start', a, 'end', b, 'brk', br, 'scheduled', sched, 'leave', lv, 'holiday', d::text = any(hol),
      'clock_in', r.clock_in, 'clock_out', r.clock_out, 'status', r.status, 'actual', act,
      'missed', coalesce(f_missed, false), 'late', coalesce(f_late, false), 'early', coalesce(f_early, false), 'absent', coalesce(f_absent, false), 'pending', pend);
  end loop;
  return res;
end $$;
revoke execute on function timesheet_days(uuid, uuid, date, date) from anon, public, authenticated;

-- 4. A week for everyone HR can see (HR) or just yourself (staff). Approved weeks show the figures as approved.
create function timesheet_week(p_company uuid, p_week_start date) returns jsonb
  language plpgsql stable security definer set search_path = public as
$$ declare hr boolean; ws date; m record; t timesheet_weeks; dys jsonb; people jsonb := '[]'::jsonb;
begin
  if not (is_company_hr(p_company) or is_company_member(p_company)) then raise exception 'Not a member of this company.'; end if;
  hr := is_company_hr(p_company);
  ws := timesheet_week_start(p_company, p_week_start);
  for m in select cm.user_id from company_members cm where cm.company_id = p_company and (hr or cm.user_id = auth.uid())
      and (cm.active or exists (select 1 from attendance_records ar where ar.company_id = p_company and ar.user_id = cm.user_id and ar.day between ws and ws + 6)
           or exists (select 1 from timesheet_weeks x where x.company_id = p_company and x.user_id = cm.user_id and x.week_start = ws))
      order by cm.created_at loop
    t := null;
    select * into t from timesheet_weeks x where x.company_id = p_company and x.user_id = m.user_id and x.week_start = ws;
    if t.company_id is not null then dys := t.days; else dys := timesheet_days(p_company, m.user_id, ws, ws + 6); end if;
    people := people || jsonb_build_object('user_id', m.user_id, 'days', dys,
      'approved', case when t.company_id is null then null else jsonb_build_object(
        'scheduled', t.scheduled_min, 'actual', t.actual_min, 'overtime', t.overtime_min, 'holiday', t.holiday_min,
        'rate', t.overtime_rate, 'holiday_rate', t.holiday_rate, 'paid', t.overtime_paid, 'note', t.note,
        'by', t.approved_by, 'at', t.approved_at) end);
  end loop;
  return jsonb_build_object('week_start', ws, 'week_end', ws + 6, 'people', people);
end $$;
revoke execute on function timesheet_week(uuid, date) from anon, public;
grant execute on function timesheet_week(uuid, date) to authenticated;

-- 5. Approve a week: checks it is finished and clean, stores the figures and candidate overtime, locks the days.
create function approve_timesheet(p_company uuid, p_user uuid, p_week_start date, p_note text default null) returns timesheet_weeks
  language plpgsql security definer set search_path = public as
$$ declare
  ot jsonb; on_ot boolean; after_m int; rate numeric; hrate numeric; dys jsonb; dy jsonb; out_days jsonb := '[]'::jsonb;
  s_min int := 0; a_min int := 0; o_min int := 0; h_min int := 0; o int; h int; rec timesheet_weeks;
begin
  if not is_company_hr(p_company) then raise exception 'Only HR, owners and admins can approve timesheets.'; end if;
  if p_user = auth.uid() and not (is_platform_admin() or exists (select 1 from company_members where company_id = p_company and user_id = auth.uid() and role = 'owner')) then
    raise exception 'Someone else in HR must approve your own timesheet.';
  end if;
  if not exists (select 1 from company_members where company_id = p_company and user_id = p_user) then raise exception 'That person is not in this company.'; end if;
  if p_week_start <> timesheet_week_start(p_company, p_week_start) then
    raise exception 'Weeks start on %.', to_char(timesheet_week_start(p_company, p_week_start), 'FMDay');
  end if;
  if p_week_start + 6 >= current_date then
    raise exception 'This week ends on %. Approve it after that.', to_char(p_week_start + 6, 'DD Mon');
  end if;
  if exists (select 1 from timesheet_weeks where company_id = p_company and user_id = p_user and week_start between p_week_start - 6 and p_week_start + 6) then
    raise exception 'This week is already approved.';
  end if;
  dys := timesheet_days(p_company, p_user, p_week_start, p_week_start + 6);
  if exists (select 1 from jsonb_array_elements(dys) x where jsonb_array_length(x->'pending') > 0) then
    raise exception 'Decide the corrections waiting for this week first.';
  end if;
  if exists (select 1 from jsonb_array_elements(dys) x where (x->>'missed')::boolean) then
    raise exception 'Fix the missed punches first, so the hours are known.';
  end if;
  select coalesce(settings->'8_overtime_rules', '{}'::jsonb) into ot from companies where id = p_company;
  on_ot := coalesce((ot->>'enabled')::boolean, true);
  after_m := (coalesce(nullif(ot->>'after', '')::numeric, 8) * 60)::int;
  rate := coalesce(nullif(ot->>'rate', '')::numeric, 1.25);
  hrate := coalesce(nullif(ot->>'holidayRate', '')::numeric, 2);
  for dy in select * from jsonb_array_elements(dys) loop
    o := 0; h := 0;
    if on_ot then
      if (dy->>'holiday')::boolean then h := (dy->>'actual')::int;
      else o := greatest(0, (dy->>'actual')::int - after_m); end if;
    end if;
    s_min := s_min + (dy->>'scheduled')::int; a_min := a_min + (dy->>'actual')::int; o_min := o_min + o; h_min := h_min + h;
    out_days := out_days || (dy || jsonb_build_object('overtime', o, 'holiday_ot', h));
  end loop;
  insert into timesheet_weeks (company_id, user_id, week_start, scheduled_min, actual_min, overtime_min, holiday_min, overtime_rate, holiday_rate, days, note, approved_by)
    values (p_company, p_user, p_week_start, s_min, a_min, o_min, h_min, rate, hrate, out_days, nullif(left(btrim(p_note), 200), ''), auth.uid())
    returning * into rec;
  perform log_employee_event(p_company, p_user, 'timesheet', 'Timesheet approved for the week of ' || to_char(p_week_start, 'DD Mon YYYY') || ': '
    || round(a_min / 60.0, 1) || 'h worked of ' || round(s_min / 60.0, 1) || 'h scheduled'
    || case when o_min + h_min > 0 then ', ' || round((o_min + h_min) / 60.0, 1) || 'h overtime (not paid yet)' else '' end);
  insert into company_audit (company_id, actor, action, detail) values (p_company, auth.uid(), 'timesheet_approved', p_user::text || ' ' || p_week_start::text);
  return rec;
end $$;
revoke execute on function approve_timesheet(uuid, uuid, date, text) from anon, public;
grant execute on function approve_timesheet(uuid, uuid, date, text) to authenticated;

-- 6. Reopen an approved week (unlocks the days, removes its overtime). Not once its overtime has been paid.
create function reopen_timesheet(p_company uuid, p_user uuid, p_week_start date, p_reason text) returns void
  language plpgsql security definer set search_path = public as
$$ declare t timesheet_weeks;
begin
  if not is_company_hr(p_company) then raise exception 'Only HR, owners and admins can reopen timesheets.'; end if;
  if coalesce(char_length(btrim(p_reason)), 0) < 2 then raise exception 'Give a reason for reopening.'; end if;
  select * into t from timesheet_weeks where company_id = p_company and user_id = p_user and week_start = p_week_start;
  if not found then raise exception 'That week is not approved.'; end if;
  if t.overtime_paid then raise exception 'Overtime from this week has been paid, so it cannot be reopened.'; end if;
  delete from timesheet_weeks where company_id = p_company and user_id = p_user and week_start = p_week_start;
  perform log_employee_event(p_company, p_user, 'timesheet', 'Timesheet reopened for the week of ' || to_char(p_week_start, 'DD Mon YYYY') || ': ' || left(btrim(p_reason), 200));
  insert into company_audit (company_id, actor, action, detail) values (p_company, auth.uid(), 'timesheet_reopened', p_user::text || ' ' || p_week_start::text);
end $$;
revoke execute on function reopen_timesheet(uuid, uuid, date, text) from anon, public;
grant execute on function reopen_timesheet(uuid, uuid, date, text) to authenticated;
